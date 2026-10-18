// ===== 4. МЕСЯЧНЫЙ КАЛЕНДАРЬ =====

const currentYear = new Date().getFullYear();
const minCalDate = new Date(currentYear, 0, 1); // 1 января текущего года
const maxCalDate = new Date(currentYear + 3, 11, 31); // текущий год + 3 года

function openCalendar() {
  const d = parseDate(state.selectedDate);
  state.calendarYear = d.getFullYear();
  state.calendarMonth = d.getMonth();
  renderCalendar();
  goScreen('calendar');
}

async function renderCalendar() {
  const titleEl = document.getElementById('cal-month-title');
  const gridEl = document.getElementById('calendar-grid');
  if (!gridEl) return;

  if (titleEl) {
    titleEl.textContent = `${RU_MONTHS_NOM[state.calendarMonth]} ${state.calendarYear}`;
  }

  // Вычисляем первый день месяца и количество дней
  const firstDay = new Date(state.calendarYear, state.calendarMonth, 1);
  const lastDay = new Date(state.calendarYear, state.calendarMonth + 1, 0);

  // Сводка по дням за этот месяц
  const fromStr = fmt(firstDay);
  const toStr = fmt(lastDay);

  let monthSummary = new Map();
  try {
    const summary = await api(`/days?from=${fromStr}&to=${toStr}`);
    for (const item of summary) monthSummary.set(item.date, item);
  } catch {}

  gridEl.innerHTML = '';

  // Смещение на понедельник (0 = Пн, 6 = Вс)
  const startDayOffset = (firstDay.getDay() + 6) % 7;

  // Пустые/предыдущие ячейки
  for (let i = 0; i < startDayOffset; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day-cell other-month';
    gridEl.appendChild(emptyCell);
  }

  // Дни месяца
  const daysInMonth = lastDay.getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDateStr = `${state.calendarYear}-${pad(state.calendarMonth + 1)}-${pad(day)}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';

    if (cellDateStr === todayStr) cell.classList.add('is-today');
    if (cellDateStr === state.selectedDate) cell.classList.add('selected');

    const info = monthSummary.get(cellDateStr) || { count: 0, has_note: false };

    let dotsHtml = '';
    const dotsCount = Math.min(info.count, 3);
    for (let dot = 0; dot < dotsCount; dot++) {
      dotsHtml += '<span class="appt-dot"></span>';
    }

    const noteHtml = info.has_note ? '<span class="cal-cell-note">📝</span>' : '';

    cell.innerHTML = `
      <span class="cal-day-num">${day}</span>
      <div class="cal-cell-dots">${dotsHtml}</div>
      ${noteHtml}
    `;

    cell.addEventListener('click', () => {
      haptic('light');
      selectDate(cellDateStr);
      goScreen('main');
    });

    gridEl.appendChild(cell);
  }
}

document.getElementById('btn-cal-prev-month')?.addEventListener('click', () => {
  haptic('light');
  state.calendarMonth--;
  if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear--;
  }
  // Ограничение с 1 января текущего года
  if (state.calendarYear < currentYear) {
    state.calendarYear = currentYear;
    state.calendarMonth = 0;
  }
  renderCalendar();
});

document.getElementById('btn-cal-next-month')?.addEventListener('click', () => {
  haptic('light');
  state.calendarMonth++;
  if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear++;
  }
  // Ограничение текущий год + 3 года
  if (state.calendarYear > currentYear + 3) {
    state.calendarYear = currentYear + 3;
    state.calendarMonth = 11;
  }
  renderCalendar();
});

document.getElementById('btn-cal-goto-today')?.addEventListener('click', () => {
  haptic('light');
  selectDate(todayStr);
  goScreen('main');
});
