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

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad(h)}:${pad(m)}`;
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

const state = {
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
  isAdmin: false,                       // администратор (по ответу сервера /api/me)
  actAs: null,                          // ID тренера, чьи записи правит админ; null — свои данные
  actAsLabel: '',                       // как показывать этого тренера (имя, @username или ID)
};

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
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
}

// Подключаем слушатели навигации Telegram WebApp
if (tg) {
  tg.BackButton?.onClick(() => goScreen('main'));
  tg.MainButton?.onClick(() => {
    if (state.currentScreen === 'form') saveAppointment();
    else if (state.currentScreen === 'note') saveDayNote();
  });
}
