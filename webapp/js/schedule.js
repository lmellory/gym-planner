// ===== 1. ПОЛОСА НЕДЕЛИ И СПИСОК ДНЯ =====

async function loadWeekSummary() {
  const from = state.weekStart;
  const to = addDays(state.weekStart, 6);
  try {
    const summary = await api(`/days?from=${from}&to=${to}`);
    state.daySummaryMap.clear();
    for (const item of summary) {
      state.daySummaryMap.set(item.date, item);
    }
    renderWeekStrip();
  } catch (err) {
    console.error('Ошибка загрузки сводки дней:', err);
  }
}

function renderWeekStrip() {
  const strip = document.getElementById('week-strip');
  const periodLabel = document.getElementById('week-period-label');
  if (!strip) return;

  const mDate = parseDate(state.weekStart);
  const sundayDate = parseDate(addDays(state.weekStart, 6));

  if (periodLabel) {
    if (mDate.getMonth() === sundayDate.getMonth()) {
      periodLabel.textContent = `${mDate.getDate()} – ${sundayDate.getDate()} ${RU_MONTHS[mDate.getMonth()]} ${mDate.getFullYear()}`;
    } else {
      periodLabel.textContent = `${mDate.getDate()} ${RU_MONTHS[mDate.getMonth()]} – ${sundayDate.getDate()} ${RU_MONTHS[sundayDate.getMonth()]}`;
    }
  }

  strip.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const dateStr = addDays(state.weekStart, i);
    const d = parseDate(dateStr);
    const dayNum = d.getDate();
    const dayShort = RU_WEEKDAYS_SHORT[i];
    const isSelected = dateStr === state.selectedDate;
    const isToday = dateStr === todayStr;

    const summary = state.daySummaryMap.get(dateStr) || { count: 0, has_note: false };

    const col = document.createElement('div');
    col.className = `week-day-col ${isSelected ? 'selected' : ''} ${isToday ? 'is-today' : ''}`;
    col.setAttribute('data-date', dateStr);

    let dotsHtml = '';
    const dotsCount = Math.min(summary.count, 3);
    for (let dot = 0; dot < dotsCount; dot++) {
      dotsHtml += '<span class="appt-dot"></span>';
    }

    const noteBadge = summary.has_note ? '<span class="note-badge-icon">📝</span>' : '';

    col.innerHTML = `
      <span class="day-col-name">${dayShort}</span>
      <span class="day-col-num">${dayNum}</span>
      <div class="day-indicators">
        ${dotsHtml}
        ${noteBadge}
      </div>
    `;

    col.addEventListener('click', () => {
      haptic('light');
      selectDate(dateStr);
    });

    strip.appendChild(col);
  }
}

function selectDate(dateStr) {
  state.selectedDate = dateStr;
  const monday = fmt(mondayOf(parseDate(dateStr)));
  if (monday !== state.weekStart) {
    state.weekStart = monday;
    loadWeekSummary();
  } else {
    renderWeekStrip();
  }
  loadSelectedDay();
}

function shiftWeek(days) {
  haptic('light');
  state.weekStart = addDays(state.weekStart, days);
  // Переносим выбранный день на аналогичный день сдвинутой недели
  const currentOffset = Math.floor((parseDate(state.selectedDate) - parseDate(state.weekStart)) / (86400000));
  if (currentOffset < 0 || currentOffset > 6) {
    state.selectedDate = state.weekStart;
  }
  loadWeekSummary();
  loadSelectedDay();
}

// Свайп по полосе недели
let touchStartX = 0;
let touchStartY = 0;
const stripContainer = document.getElementById('week-strip-container');
if (stripContainer) {
  stripContainer.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  stripContainer.addEventListener('touchend', (e) => {
    const diffX = e.changedTouches[0].clientX - touchStartX;
    const diffY = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX < 0) shiftWeek(7);  // свайп влево -> следующая неделя
      else shiftWeek(-7);          // свайп вправо -> предыдущая неделя
    }
  }, { passive: true });
}

// ===== 2. ЗАПИСИ И ЗАМЕТКА ВЫБРАННОГО ДНЯ =====

async function loadSelectedDay() {
  const heading = document.getElementById('selected-day-heading');
  const sub = document.getElementById('selected-day-sub');
  const listEl = document.getElementById('appointments-list');
  const noteCard = document.getElementById('day-note-card');
  const noteContent = document.getElementById('day-note-content');
  const btnNoteText = document.getElementById('btn-day-note-text');

  if (heading) {
    heading.textContent = state.selectedDate === todayStr ? 'Сегодня' : formatFullDateRu(state.selectedDate);
  }
  if (sub) {
    sub.textContent = state.selectedDate === todayStr ? formatFullDateRu(state.selectedDate) : '';
  }

  // Защита от race condition: отменяем предыдущий запрос и сверяем seq
  const reqId = ++currentDayRequestId;
  if (currentDayAbortCtrl) {
    try { currentDayAbortCtrl.abort(); } catch {}
  }
  currentDayAbortCtrl = new AbortController();
  const dateToLoad = state.selectedDate;

  // Загружаем записи и заметку дня
  try {
    const [appts, noteRes] = await Promise.all([
      api(`/appointments?from=${dateToLoad}&to=${dateToLoad}`, { signal: currentDayAbortCtrl.signal }),
      api(`/notes/${dateToLoad}`, { signal: currentDayAbortCtrl.signal }),
    ]);

    if (reqId !== currentDayRequestId || dateToLoad !== state.selectedDate) return;

    state.appointments = appts;
    state.currentDayNote = noteRes?.text || '';

    // Отображение заметки
    if (state.currentDayNote.trim()) {
      if (noteCard) noteCard.style.display = 'block';
      if (noteContent) noteContent.textContent = state.currentDayNote;
      if (btnNoteText) btnNoteText.textContent = 'Заметка 📝';
    } else {
      if (noteCard) noteCard.style.display = 'none';
      if (btnNoteText) btnNoteText.textContent = 'Заметка';
    }

    // Отображение списка записей
    renderAppointmentsList();
    await loadFreeSlots(dateToLoad);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Ошибка загрузки дня:', err);
    if (listEl && reqId === currentDayRequestId) {
      listEl.innerHTML = '<div class="empty-state"><p>Ошибка загрузки записей</p></div>';
    }
  }
}

let currentDayRequestId = 0;
let currentDayAbortCtrl = null;

async function loadFreeSlots(dateStr) {
  const card = document.getElementById('free-slots-card');
  const countEl = document.getElementById('free-slots-count');
  const chipsEl = document.getElementById('free-slots-chips');
  if (!card || !chipsEl) return;

  try {
    const res = await api(`/days/slots?date=${dateStr}`);
    if (!res.is_work_day || !res.slots || !res.slots.length) {
      card.style.display = 'none';
      return;
    }

    if (countEl) countEl.textContent = `${res.slots.length}`;
    chipsEl.innerHTML = '';
    for (const slot of res.slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-chip';
      btn.textContent = `✨ ${slot.start}`;
      btn.addEventListener('click', () => {
        haptic('light');
        openForm({ date: dateStr, start_time: slot.start });
      });
      chipsEl.appendChild(btn);
    }
    card.style.display = 'block';
  } catch {
    card.style.display = 'none';
  }
}

// Виды занятий (ключи совпадают с src/lib/services.ts)
const SERVICE_RU = {
  personal: 'Персональная тренировка',
  split: 'Сплит-тренировка',
  group: 'Групповое занятие',
  trial: 'Пробное занятие',
  consultation: 'Консультация',
  online: 'Онлайн-тренировка',
};
const serviceRu = (key) => SERVICE_RU[key] || key;

const STATUS_RU = { no_show: 'Не пришёл', cancelled: 'Отменена' };
const statusBadgeHtml = (a) => (STATUS_RU[a.status] ? `<span class="appt-status-badge is-${a.status}">${STATUS_RU[a.status]}</span>` : '');
const inactiveClass = (a) => (STATUS_RU[a.status] ? ' is-inactive' : '');

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
}

function renderAppointmentsList() {
  const listEl = document.getElementById('appointments-list');
  if (!listEl) return;

  if (!state.appointments.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <img src="/assets/empty-workout.png" class="empty-state-img" alt="">
        <div class="empty-state-title">Записей нет</div>
        <p>Нажмите «+» внизу экрана, чтобы записать клиента на тренировку</p>
      </div>
    `;
    return;
  }

  // Считаем активные записи на одно и то же время
  const timeCounts = {};
  for (const a of state.appointments) {
    if (a.status === 'scheduled') {
      timeCounts[a.start_time] = (timeCounts[a.start_time] || 0) + 1;
    }
  }

  listEl.innerHTML = '';
  let lastActiveEndMins = null;

  for (const a of state.appointments) {
    if (a.status === 'scheduled') {
      const startMins = timeToMinutes(a.start_time);
      if (lastActiveEndMins !== null && startMins - lastActiveEndMins >= 30) {
        const gapMins = startMins - lastActiveEndMins;
        const gapStartStr = minutesToTime(lastActiveEndMins);
        const gapEl = document.createElement('div');
        gapEl.className = 'appt-gap-indicator';
        gapEl.title = `Свободное время: ${formatGapDuration(gapMins)}`;
        gapEl.innerHTML = `
          <span class="appt-gap-line"></span>
          <span class="appt-gap-badge">☕ Окно ${formatGapDuration(gapMins)} <span class="appt-gap-action">+ запись</span></span>
          <span class="appt-gap-line"></span>
        `;
        gapEl.addEventListener('click', (e) => {
          e.stopPropagation();
          haptic('light');
          openForm({ date: state.selectedDate, start_time: gapStartStr });
        });
        listEl.appendChild(gapEl);
      }
      const endMins = a.end_time ? timeToMinutes(a.end_time) : (startMins + 60);
      lastActiveEndMins = lastActiveEndMins === null ? endMins : Math.max(lastActiveEndMins, endMins);
    }

    const card = document.createElement('div');
    card.className = 'appointment-card' + inactiveClass(a);
    card.setAttribute('data-id', a.id);

    const whoHtml = a.who ? `<span class="appt-card-who">${escapeHtml(a.who)}</span>` : '';
    const serviceName = serviceRu(a.service);
    const commentHtml = a.comment
      ? `<div class="appt-card-comment">💬 ${escapeHtml(a.comment)}</div>`
      : '';

    const isSimultaneous = timeCounts[a.start_time] > 1 && a.status === 'scheduled';
    const sameTimeBadge = isSimultaneous
      ? `<span class="appt-same-time-badge" title="Несколько человек на одно время">👥 ${timeCounts[a.start_time]} чел.</span>`
      : '';

    card.innerHTML = `
      <div class="appt-card-top">
        <div class="appt-card-time-group">
          <span class="appt-card-time">🕐 ${formatApptTime(a)}</span>
          ${sameTimeBadge}
        </div>
        <div class="appt-card-top-right">
          ${statusBadgeHtml(a)}
          ${a.price != null ? `<span class="appt-card-price">${formatMoney(a.price)}</span>` : ''}
        </div>
      </div>
      <div class="appt-card-client">${escapeHtml(a.client_name)}</div>
      ${whoHtml}
      <div class="appt-card-service">
        <img src="/assets/service-${a.service}.png" class="appt-service-icon" alt="">
        <strong>${serviceName}</strong>${a.series_id ? '<span class="appt-series-mark" title="Повторяющаяся запись">🔁</span>' : ''}
      </div>
      ${commentHtml}
    `;

    card.addEventListener('click', () => {
      haptic('light');
      openForm(a);
    });

    listEl.appendChild(card);
  }
}

function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad(h)}:${pad(m)}`;
}

function formatGapDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
