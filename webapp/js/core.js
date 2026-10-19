// ==========================================================================
// Ежедневник тренера: Telegram Mini App Frontend (чистый JS, без сборки)
// ==========================================================================

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try {
    // Предотвращаем случайное закрытие приложения свайпом вниз при прокрутке расписания
    tg.disableVerticalSwipes?.();
  } catch {}

  const syncTgTheme = () => {
    const isDark = tg.colorScheme === 'dark' || window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark-theme', isDark);
    const bg = tg.themeParams?.bg_color || (isDark ? '#141517' : '#f7f7f8');
    try {
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
    } catch {}
  };

  syncTgTheme();
  tg.onEvent?.('themeChanged', syncTgTheme);
}

/**
 * Ссылки: t.me открываем внутри Telegram, остальные — во внешнем браузере.
 * Методы появились в Bot API 6.1; если клиент старее, срабатывает обычный window.open.
 */
function isTelegramLink(url) {
  return /^https:\/\/(t\.me|telegram\.me|telegram\.dog)\//.test(url);
}

function openExternal(url) {
  if (!url) return;
  try {
    if (isTelegramLink(url) && typeof tg?.openTelegramLink === 'function') {
      tg.openTelegramLink(url);
      return;
    }
    if (typeof tg?.openLink === 'function') {
      tg.openLink(url, { try_instant_view: false });
      return;
    }
  } catch (err) {
    console.error('openExternal failed', err);
  }
  window.open(url, '_blank', 'noopener');
}

// ===== Отчёт об ошибках с клиента =====
// Не больше пяти сообщений за сессию: лог не должен превращаться в поток.
const APP_VERSION = '13';
let clientErrorsSent = 0;

function reportClientError(kind, message, stack) {
  if (clientErrorsSent >= 5) return;
  clientErrorsSent += 1;
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        kind,
        message: String(message || '').slice(0, 300),
        stack: String(stack || '').slice(0, 800),
        url: location.href,
        version: APP_VERSION,
      }),
    }).catch(() => {});
  } catch {
    /* сам отчёт не должен ломать приложение */
  }
}

window.addEventListener('error', (e) => reportClientError('error', e.message, e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  reportClientError('promise', (reason && reason.message) || reason, reason && reason.stack);
});

/** Запрос к API. Подпись Telegram передаётся в заголовке X-Init-Data */
async function api(path, options = {}) {
  const initData = tg?.initData || '';
  let res;
  try {
    res = await fetch('/api' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Init-Data': initData,
        // Админ правит записи выбранного тренера: сервер выполнит запрос над его данными (и только для записей)
        ...(state.actAs ? { 'X-Act-As': String(state.actAs) } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    showToast('Ошибка сети');
    throw err;
  }
  // 5xx — это наша ошибка, а не сеть: отправляем на сервер, чтобы увидеть в логах
  if (res.status >= 500) {
    reportClientError('api', `${options.method || 'GET'} /api${path} → ${res.status}`, '');
  }
  if (res.status === 403) {
    const overlay = document.getElementById('session-expired-overlay');
    if (overlay) overlay.style.display = 'flex';
    else showToast('Сессия Telegram устарела. Перезапустите приложение');
    throw new Error('Сессия устарела');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || 'Ошибка ' + res.status;
    showToast(msg);
    throw new Error(msg);
  }
  return res.json();
}

// ===== Утилиты для работы с датами и временем =====
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins || 0));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad(h)}:${pad(m)}`;
}

function formatGapDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/**
 * Вычисляет свободные окна в расписании с учётом рабочих часов.
 * @param {Array} appointments Записи за день
 * @param {string|null} [workStart] Начало рабочего дня (например '08:00')
 * @param {string|null} [workEnd] Конец рабочего дня (например '20:00')
 * @param {number} [minGapMinutes=30] Минимальная длина окна
 */
function computeGaps(appointments, workStart = null, workEnd = null, minGapMinutes = 30) {
  const active = (appointments || [])
    .filter((a) => a && a.status === 'scheduled' && a.start_time)
    .map((a) => {
      const s = timeToMinutes(a.start_time);
      const e = a.end_time ? timeToMinutes(a.end_time) : s + 60;
      return { id: a.id, start: s, end: Math.max(s, e) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const gaps = [];
  const ws = workStart ? timeToMinutes(workStart) : null;
  const we = workEnd ? timeToMinutes(workEnd) : null;

  if (active.length === 0) {
    if (ws !== null && we !== null && we - ws >= minGapMinutes) {
      gaps.push({
        start: minutesToTime(ws),
        end: minutesToTime(we),
        duration: we - ws,
        afterId: null,
        beforeId: null,
      });
    }
    return gaps;
  }

  // Окно от начала рабочего дня до первой записи
  if (ws !== null && active[0].start - ws >= minGapMinutes) {
    gaps.push({
      start: minutesToTime(ws),
      end: minutesToTime(active[0].start),
      duration: active[0].start - ws,
      afterId: null,
      beforeId: active[0].id,
    });
  }

  // Окна между записями
  let currentEnd = active[0].end;
  let lastApptId = active[0].id;

  for (let i = 1; i < active.length; i++) {
    const cur = active[i];
    if (cur.start - currentEnd >= minGapMinutes) {
      gaps.push({
        start: minutesToTime(currentEnd),
        end: minutesToTime(cur.start),
        duration: cur.start - currentEnd,
        afterId: lastApptId,
        beforeId: cur.id,
      });
    }
    if (cur.end > currentEnd) {
      currentEnd = cur.end;
      lastApptId = cur.id;
    }
  }

  // Окно после последней записи до конца рабочего дня
  if (we !== null && we - currentEnd >= minGapMinutes) {
    gaps.push({
      start: minutesToTime(currentEnd),
      end: minutesToTime(we),
      duration: we - currentEnd,
      afterId: lastApptId,
      beforeId: null,
    });
  }

  return gaps;
}

function formatApptTime(a) {
  if (!a) return '';
  return a.start_time;
}

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function mondayOf(d) {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7; // 0 = Пн, 6 = Вс
  x.setDate(x.getDate() - wd);
  return x;
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
const RU_MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const RU_WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Подпись валюты у сумм. Настраивается в «Настройках» (поле «Валюта»); по умолчанию — «руб.».
const DEFAULT_CURRENCY = 'руб.';
let CURRENCY = DEFAULT_CURRENCY;
function formatMoney(n) {
  const num = new Intl.NumberFormat('ru-RU').format(Math.round(Number(n) || 0));
  return CURRENCY ? `${num}\u00A0${CURRENCY}` : num;
}
const RU_WEEKDAYS_FULL = [
  'Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'
];

function formatFullDateRu(dateStr) {
  const d = parseDate(dateStr);
  const weekday = RU_WEEKDAYS_FULL[d.getDay()];
  return `${weekday}, ${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function updateGreeting() {
  const dateEl = document.getElementById('greeting-date');
  const titleEl = document.getElementById('greeting-title');
  const avatarEl = document.getElementById('greeting-avatar');

  const now = new Date();
  const dStr = fmt(now);

  if (dateEl) {
    const [y, m, dNum] = dStr.split('-').map(Number);
    const wdName = RU_WEEKDAYS_FULL[now.getDay()];
    dateEl.textContent = `${wdName}, ${dNum} ${RU_MONTHS[m - 1]}`;
  }

  // Получаем имя тренера напрямую из Telegram WebApp SDK
  const user = tg?.initDataUnsafe?.user;
  const firstName = user?.first_name ? user.first_name.trim() : '';

  const hour = now.getHours();
  let greet = 'Добрый день';
  if (hour >= 5 && hour < 12) greet = 'Доброе утро';
  else if (hour >= 12 && hour < 18) greet = 'Добрый день';
  else if (hour >= 18 && hour < 23) greet = 'Добрый вечер';
  else greet = 'Доброй ночи';

  if (titleEl) {
    titleEl.textContent = firstName ? `${greet}, ${firstName} ✨` : `${greet} ✨`;
  }

  if (avatarEl) {
    if (user?.photo_url) {
      avatarEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = user.photo_url;
      img.alt = firstName || 'Тренер';
      img.className = 'avatar-img';
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = '🏋️';
    }
  }
}

// ===== Состояние приложения =====
const todayStr = fmt(new Date());

const state = (window.state = {
  currentScreen: 'main',
  selectedDate: todayStr,
  weekStart: fmt(mondayOf(new Date())),
  appointments: [],
  daySummaryMap: new Map(), // date -> { count, has_note }
  currentDayNote: '',
  editingAppointmentId: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0..11
  prices: {},                           // прайс: { personal: 800, group: null, ... }
  settings: null,                       // настройки тренера (work_start_time, work_end_time и др.)
  isAdmin: false,                       // администратор (по ответу сервера /api/me)
  actAs: null,                          // ID тренера, чьи записи правит админ; null — свои данные
  actAsLabel: '',                       // как показывать этого тренера (имя, @username или ID)
});

// ===== Уведомления (Toast) и тактильный отклик =====
let toastTimer = null;
function showToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}

function haptic(type = 'light') {
  try {
    if (type === 'light' || type === 'medium' || type === 'heavy') {
      tg?.HapticFeedback?.impactOccurred(type);
    } else if (type === 'success' || type === 'warning' || type === 'error') {
      tg?.HapticFeedback?.notificationOccurred(type);
    }
  } catch {}
}

function confirmDialog(message, callback) {
  if (tg?.showConfirm) {
    tg.showConfirm(message, callback);
  } else {
    const ok = window.confirm(message);
    callback(ok);
  }
}

// ===== Управление экранами =====
function goScreen(name) {
  state.currentScreen = name;
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));

  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add('active');

  const backBtn = document.getElementById('btn-back');
  const headerActions = document.getElementById('header-actions');
  const headerTitle = document.getElementById('header-title');

  if (name === 'main') {
    updateGreeting();
    if (backBtn) backBtn.style.display = 'none';
    if (headerActions) headerActions.style.display = 'flex';
    if (headerTitle) headerTitle.textContent = state.actAs ? '🛠 ' + state.actAsLabel : 'Ежедневник';
    tg?.BackButton?.hide();
    tg?.MainButton?.hide();
  } else {
    if (backBtn) backBtn.style.display = 'flex';
    if (headerActions) headerActions.style.display = 'none';
    tg?.BackButton?.show();

    if (name === 'form') {
      if (headerTitle) headerTitle.textContent = state.editingAppointmentId ? 'Редактирование' : 'Новая запись';
      if (tg?.MainButton) {
        tg.MainButton.setParams({
          text: 'Сохранить запись',
          color: '#f2702a',
          text_color: '#ffffff',
          is_visible: true,
        });
      }
    } else if (name === 'calendar') {
      if (headerTitle) headerTitle.textContent = 'Календарь';
      tg?.MainButton?.hide();
    } else if (name === 'note') {
      if (headerTitle) headerTitle.textContent = 'Заметка дня';
      if (tg?.MainButton) {
        tg.MainButton.setParams({
          text: 'Сохранить заметку',
          color: '#f2702a',
          text_color: '#ffffff',
          is_visible: true,
        });
      }
    } else if (name === 'settings') {
      if (headerTitle) headerTitle.textContent = 'Настройки';
      tg?.MainButton?.hide();
    } else if (name === 'clients') {
      if (headerTitle) headerTitle.textContent = 'Клиенты';
      tg?.MainButton?.hide();
    } else if (name === 'income') {
      if (headerTitle) headerTitle.textContent = 'Доходы';
      tg?.MainButton?.hide();
    } else if (name === 'expenses') {
      if (headerTitle) headerTitle.textContent = 'Траты';
      tg?.MainButton?.hide();
    } else if (name === 'admin') {
      if (headerTitle) headerTitle.textContent = 'Админ-панель';
      tg?.MainButton?.hide();
    }
  }

  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    const mainTabs = ['main', 'clients', 'income', 'settings'];
    if (mainTabs.includes(name)) {
      bottomNav.style.display = 'flex';
      document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.screen === name);
      });
    } else {
      bottomNav.style.display = 'none';
    }
  }

  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}

// Слушатель перехода на главное расписание из нижнего таббара
document.getElementById('btn-tab-main')?.addEventListener('click', () => {
  haptic('light');
  goScreen('main');
});

// Подключаем слушатели навигации Telegram WebApp
if (tg) {
  tg.BackButton?.onClick(() => goScreen('main'));
  tg.MainButton?.onClick(() => {
    if (state.currentScreen === 'form') saveAppointment();
    else if (state.currentScreen === 'note') saveDayNote();
  });
}
