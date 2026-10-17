// ===== 3. ФОРМА ЗАПИСИ (СОЗДАНИЕ / РЕДАКТИРОВАНИЕ) =====

let selectedService = 'personal';
let selectedStatus = 'scheduled'; // scheduled | no_show | cancelled

function updateStatusUI() {
  document.querySelectorAll('#status-selector .segment-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.status === selectedStatus);
  });
}

function openForm(appt = null) {
  state.editingAppointmentId = appt && appt.id ? appt.id : null;

  const formTitle = document.getElementById('form-screen-title');
  const apptId = document.getElementById('form-appt-id');
  const dateInput = document.getElementById('form-appt-date');
  const startInput = document.getElementById('form-appt-start');
  const clientInput = document.getElementById('form-appt-client');
  const whoInput = document.getElementById('form-appt-who');
  const commentInput = document.getElementById('form-appt-comment');
  const priceInput = document.getElementById('form-appt-price');
  const deleteBtn = document.getElementById('btn-delete-appt');
  const quickTomorrowBtn = document.getElementById('btn-quick-tomorrow');
  const conflictAlert = document.getElementById('conflict-alert');

  if (conflictAlert) conflictAlert.style.display = 'none';
  resetParticipants();
  resetRepeat();
  state.editingSeries = !!(appt && appt.id && appt.series_id);

  if (appt && appt.id) {
    if (formTitle) formTitle.textContent = 'Редактирование записи';
    if (apptId) apptId.value = appt.id;
    if (dateInput) dateInput.value = appt.date;
    if (startInput) startInput.value = appt.start_time;
    if (clientInput) clientInput.value = appt.client_name;
    if (whoInput) whoInput.value = appt.who || '';
    if (commentInput) commentInput.value = appt.comment || '';
    if (priceInput) priceInput.value = appt.price ?? '';
    selectedService = appt.service || 'personal';
    selectedStatus = appt.status || 'scheduled';
    updateStatusUI();
    if (deleteBtn) deleteBtn.style.display = 'block';
    if (quickTomorrowBtn) quickTomorrowBtn.style.display = 'block';
  } else {
    if (formTitle) formTitle.textContent = 'Новая запись';
    if (apptId) apptId.value = '';
    if (dateInput) dateInput.value = appt?.date || state.selectedDate;

    // Начальное время
    if (appt?.start_time) {
      if (startInput) startInput.value = appt.start_time;
    } else {
      const now = new Date();
      let defHour = 10;
      if (state.selectedDate === todayStr) {
        defHour = Math.min(Math.max(now.getHours() + 1, 9), 20);
      }
      if (startInput) startInput.value = `${pad(defHour)}:00`;
    }

    if (clientInput) clientInput.value = appt?.client_name || '';
    if (whoInput) whoInput.value = '';
    if (commentInput) commentInput.value = '';
    if (priceInput) priceInput.value = state.prices.personal ?? '';
    selectedService = 'personal';
    selectedStatus = 'scheduled';
    updateStatusUI();
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (quickTomorrowBtn) quickTomorrowBtn.style.display = 'none';
  }

  updateServiceUI();
  updateRepeatUI();
  updateClientMatchBadge();
  updateMembershipBadge();
  goScreen('form');
  checkConflicts();
}

function updateClientMatchBadge() {
  const clientInput = document.getElementById('form-appt-client');
  const badge = document.getElementById('client-match-badge');
  if (!clientInput || !badge) return;

  const val = clientInput.value.trim().toLowerCase();
  if (!val) {
    badge.style.display = 'none';
    return;
  }

  const match = cachedClients.find((c) => c.name.toLowerCase() === val);
  if (match) {
    const parts = [];
    if (match.phone) parts.push(`📞 ${escapeHtml(String(match.phone))}`);
    if (match.notes) parts.push(`💬 ${escapeHtml(String(match.notes))}`);
    badge.innerHTML = `✨ <b>Клиент из базы:</b> ${parts.join(' · ') || 'Контакты не указаны'}`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

document.getElementById('form-appt-client')?.addEventListener('input', updateClientMatchBadge);

// ===== Абонемент клиента в форме записи =====
const ruDate = (iso) => String(iso).split('-').reverse().join('.');
let membershipBadgeSeq = 0;
let membershipBadgeTimer = null;

// Что показать по итогу summary абонемента с сервера; null — ничего (абонементов не было)
function membershipBadgeInfo(s) {
  const left = (n) => `${n} ${plural(n, 'занятие', 'занятия', 'занятий')}`;
  const planned = s.planned ? ` (всего осталось ${s.remaining}, записано вперёд ${s.planned})` : '';
  const until = s.expires_on ? ` · до ${ruDate(s.expires_on)}` : '';
  switch (s.state) {
    case 'active':
      return { warn: false, html: `🎟 <b>Абонемент:</b> свободно ${left(s.free)}${planned}${until}` };
    case 'last':
      return { warn: true, html: `⚠️ <b>Последнее занятие по абонементу</b>${planned}${until}` };
    case 'exhausted':
      return {
        warn: true,
        html: s.remaining > 0
          ? '⚠️ <b>Все оставшиеся занятия по абонементу уже записаны</b>: эта запись оплачивается отдельно'
          : '⚠️ <b>Абонемент закончился</b>: запись оплачивается отдельно',
      };
    case 'expired':
      return { warn: true, html: '⚠️ <b>Срок абонемента истёк</b>' };
    default:
      return null;
  }
}

// Подсказка работает только для клиентов из базы: абонемент привязан к точному имени
function updateMembershipBadge() {
  clearTimeout(membershipBadgeTimer);
  const badge = document.getElementById('membership-badge');
  const input = document.getElementById('form-appt-client');
  if (!badge || !input) return;
  const name = input.value.trim();
  const known = name && cachedClients.some((c) => c.name === name);
  if (!known) {
    membershipBadgeSeq++;
    badge.style.display = 'none';
    return;
  }
  membershipBadgeTimer = setTimeout(async () => {
    const seq = ++membershipBadgeSeq;
    try {
      const s = await api(`/memberships/summary?name=${encodeURIComponent(name)}`);
      if (seq !== membershipBadgeSeq) return; // клиент уже сменился
      const info = membershipBadgeInfo(s);
      if (!info) {
        badge.style.display = 'none';
        return;
      }
      badge.innerHTML = info.html;
      badge.classList.toggle('warn', info.warn);
      badge.style.display = 'block';
    } catch {
      badge.style.display = 'none';
    }
  }, 250);
}

document.getElementById('form-appt-client')?.addEventListener('input', updateMembershipBadge);

function updateServiceUI() {
  // Селектор вида занятия
  document.querySelectorAll('#service-selector .segment-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.service === selectedService);
  });
  updateParticipantsUI();
  updateRepeatSummary();
}

// ===== Участники сплита и группы =====
// Блок «Другие участники» нужен только при создании новой записи сплита или группы:
// основной клиент вводится в поле «Имя клиента», остальные — здесь, каждому создаётся своя запись.
function addParticipantRow(value = '') {
  const list = document.getElementById('participants-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'participant-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input participant-input';
  input.placeholder = 'Имя участника';
  input.maxLength = 100;
  input.autocomplete = 'off';
  input.setAttribute('list', 'clients-datalist');
  input.value = value;
  input.addEventListener('input', () => updateRepeatSummary());
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-clear';
  remove.title = 'Убрать участника';
  remove.textContent = '✕';
  remove.addEventListener('click', () => {
    row.remove();
    updateRepeatSummary();
  });
  row.append(input, remove);
  list.appendChild(row);
  return input;
}

function getParticipants() {
  return [...document.querySelectorAll('#participants-list .participant-input')]
    .map((el) => el.value.trim())
    .filter(Boolean);
}

function updateParticipantsUI() {
  const group = document.getElementById('participants-group');
  if (!group) return;
  const multi = selectedService === 'split' || selectedService === 'group';
  group.style.display = multi && !state.editingAppointmentId ? 'block' : 'none';
}

function resetParticipants() {
  const list = document.getElementById('participants-list');
  if (list) list.innerHTML = '';
}

document.getElementById('btn-add-participant')?.addEventListener('click', () => {
  haptic('light');
  addParticipantRow()?.focus();
  updateRepeatSummary();
});

// ===== Повтор записи: «вторник и четверг на N недель» =====
const MAX_REPEAT_WEEKS = 26;
const MAX_SERIES_RECORDS = 100; // столько же разрешает сервер (даты × участники)
let repeatDaysTouched = false;  // тренер сам выбирал дни: тогда не подставляем день недели от даты

// 1 = Пн … 7 = Вс
function isoWeekday(dateStr) {
  return ((parseDate(dateStr).getDay() + 6) % 7) + 1;
}

function getRepeatDays() {
  return [...document.querySelectorAll('#repeat-weekdays .weekday-chip.active')].map((b) => Number(b.dataset.wd));
}

// Те же правила, что на сервере (src/lib/recurrence.ts): недели Пн–Вс, начиная с недели первой записи,
// выбранные дни не раньше даты первой записи.
function expandRepeatDates(startDate, weekdays, weeks) {
  const monday = fmt(mondayOf(parseDate(startDate)));
  const dates = [];
  for (let w = 0; w < weeks; w++) {
    for (const wd of weekdays) {
      const d = addDays(monday, w * 7 + wd - 1);
      if (d >= startDate) dates.push(d);
    }
  }
  return dates;
}

function updateRepeatUI() {
  const group = document.getElementById('repeat-group');
  if (group) group.style.display = state.editingAppointmentId ? 'none' : 'block';
}

function resetRepeat() {
  const on = document.getElementById('form-repeat-on');
  if (on) on.checked = false;
  const options = document.getElementById('repeat-options');
  if (options) options.style.display = 'none';
  document.querySelectorAll('#repeat-weekdays .weekday-chip').forEach((b) => b.classList.remove('active'));
  const weeks = document.getElementById('form-repeat-weeks');
  if (weeks) weeks.value = '4';
  repeatDaysTouched = false;
  const summary = document.getElementById('repeat-summary');
  if (summary) summary.textContent = '';
}

// Пока тренер не выбирал дни сам, отмечаем день недели выбранной даты
function syncRepeatDefaultDay() {
  if (repeatDaysTouched) return;
  const date = document.getElementById('form-appt-date')?.value;
  if (!date) return;
  const wd = isoWeekday(date);
  document.querySelectorAll('#repeat-weekdays .weekday-chip').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.wd) === wd);
  });
}

function updateRepeatSummary() {
  const el = document.getElementById('repeat-summary');
  if (!el) return;
  if (!document.getElementById('form-repeat-on')?.checked) {
    el.textContent = '';
    return;
  }
  const warn = (text) => {
    el.textContent = text;
    el.classList.add('warn');
  };
  el.classList.remove('warn');

  const date = document.getElementById('form-appt-date')?.value;
  const weeks = Number(document.getElementById('form-repeat-weeks')?.value);
  const days = getRepeatDays();
  if (!date) return warn('Укажите дату первой записи');
  if (!days.length) return warn('Выберите хотя бы один день недели');
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS) {
    return warn(`Число недель: от 1 до ${MAX_REPEAT_WEEKS}`);
  }

  const dates = expandRepeatDates(date, days, weeks);
  if (!dates.length) return warn('В выбранный период нет подходящих дней');

  const multi = selectedService === 'split' || selectedService === 'group';
  const people = 1 + (multi ? getParticipants().length : 0);
  const total = dates.length * people;
  const short = (d) => d.split('-').reverse().slice(0, 2).join('.');
  const range = dates.length > 1 ? `с ${short(dates[0])} по ${short(dates[dates.length - 1])}` : `на ${short(dates[0])}`;
  if (total > MAX_SERIES_RECORDS) {
    return warn(`Слишком много записей: ${total} (максимум ${MAX_SERIES_RECORDS}). Уменьшите число недель, дней или участников.`);
  }
  el.textContent = people > 1
    ? `Будет создано записей: ${total} (${dates.length} занятий × ${people} чел.), ${range}`
    : `Будет создано записей: ${total}, ${range}`;
}

document.getElementById('form-repeat-on')?.addEventListener('change', (e) => {
  haptic('light');
  const options = document.getElementById('repeat-options');
  if (options) options.style.display = e.target.checked ? 'block' : 'none';
  if (e.target.checked) syncRepeatDefaultDay();
  updateRepeatSummary();
});

document.querySelectorAll('#repeat-weekdays .weekday-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    repeatDaysTouched = true;
    btn.classList.toggle('active');
    updateRepeatSummary();
  });
});

document.getElementById('form-repeat-weeks')?.addEventListener('input', updateRepeatSummary);
document.getElementById('form-appt-date')?.addEventListener('change', () => {
  syncRepeatDefaultDay();
  updateRepeatSummary();
});

// Подстановка цены из прайса при смене услуги. Цену, которую тренер вписал вручную, не трогаем:
// заменяем значение, только если поле пустое или там цена прежней услуги из прайса.
function autofillPrice(prevService) {
  const el = document.getElementById('form-appt-price');
  if (!el) return;
  const cur = el.value.trim();
  const prevAuto = state.prices[prevService] != null ? String(state.prices[prevService]) : '';
  if (cur === '' || cur === prevAuto) el.value = state.prices[selectedService] ?? '';
}

// Выбор статуса записи
document.querySelectorAll('#status-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    selectedStatus = btn.dataset.status;
    updateStatusUI();
    checkConflicts();
  });
});

// Нажатия на кнопки выбора вида занятия
document.querySelectorAll('#service-selector .segment-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const prevService = selectedService;
    selectedService = btn.dataset.service;
    autofillPrice(prevService);
    updateServiceUI();
    checkConflicts();
  });
});

// Проверка пересечений по времени перед сохранением
let conflictCheckTimer = null;
async function checkConflicts() {
  clearTimeout(conflictCheckTimer);
  conflictCheckTimer = setTimeout(async () => {
    const date = document.getElementById('form-appt-date')?.value;
    const start = document.getElementById('form-appt-start')?.value;
    const excludeId = state.editingAppointmentId || 0;
    const alertEl = document.getElementById('conflict-alert');
    const alertText = document.getElementById('conflict-alert-text');

    if (!date || !start) {
      if (alertEl) alertEl.style.display = 'none';
      return;
    }

    try {
      const res = await api('/appointments/check', {
        method: 'POST',
        body: JSON.stringify({
          date,
          start_time: start,
          service: selectedService,
          exclude_id: excludeId,
        }),
      });

      if (res.conflicts && res.conflicts.length > 0) {
        // Информируем тренера, что на это время уже есть клиенты (без тревожного вибросигнала)
        const listStr = res.conflicts
          .map((c) => `• <b>${formatApptTime(c)}</b>: ${escapeHtml(c.client_name)} (${serviceRu(c.service)})`)
          .join('<br>');
        if (alertText) alertText.innerHTML = listStr;
        if (alertEl) alertEl.style.display = 'flex';
      } else {
        if (alertEl) alertEl.style.display = 'none';
      }
    } catch {}
  }, 350);
}

document.getElementById('form-appt-date')?.addEventListener('change', checkConflicts);
document.getElementById('form-appt-start')?.addEventListener('change', checkConflicts);

// Сохранение записи
async function saveAppointment() {
  const date = document.getElementById('form-appt-date')?.value;
  const start_time = document.getElementById('form-appt-start')?.value;
  const client_name = document.getElementById('form-appt-client')?.value?.trim();
  const who = document.getElementById('form-appt-who')?.value?.trim() || null;
  const comment = document.getElementById('form-appt-comment')?.value?.trim() || null;

  if (!date) return showToast('Укажите дату');
  if (!start_time) return showToast('Укажите время тренировки');
  if (!client_name) return showToast('Укажите имя клиента');

  const priceEl = document.getElementById('form-appt-price');
  // Браузер стирает value у нечислового ввода («1e», «--»): ловим это, чтобы не сохранить запись молча без цены
  if (priceEl?.validity?.badInput) return showToast('Цена — целое число, например 800');
  const priceRaw = priceEl?.value?.trim() ?? '';
  let price = null;
  if (priceRaw !== '') {
    price = Number(priceRaw);
    if (!Number.isInteger(price) || price < 0) return showToast('Цена — целое число, например 800');
  }

  let repeat = null;
  if (!state.editingAppointmentId && document.getElementById('form-repeat-on')?.checked) {
    const weekdays = getRepeatDays();
    const weeks = Number(document.getElementById('form-repeat-weeks')?.value);
    if (!weekdays.length) return showToast('Выберите дни недели для повтора');
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS) {
      return showToast(`Число недель: от 1 до ${MAX_REPEAT_WEEKS}`);
    }
    repeat = { weekdays, weeks };
  }

  const payload = {
    date,
    start_time,
    client_name,
    who,
    service: selectedService,
    comment,
    price,
    status: selectedStatus,
  };

  try {
    if (state.editingAppointmentId) {
      await api(`/appointments/${state.editingAppointmentId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Запись обновлена ✅');
    } else {
      const participants = selectedService === 'split' || selectedService === 'group' ? getParticipants() : [];
      if (participants.length) payload.participants = participants;
      if (repeat) payload.repeat = repeat;
      const res = await api('/appointments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const count = Array.isArray(res?.ids) ? res.ids.length : 1;
      showToast(count > 1 ? `Добавлено записей: ${count} ✅` : 'Запись добавлена ✅');
    }

    haptic('success');
    state.selectedDate = date;
    state.weekStart = fmt(mondayOf(parseDate(date)));

    // Обновляем список клиентов в фоне, чтобы автоподстановка сразу знала нового клиента
    loadClientsDatalist().catch(() => {});

    goScreen('main');
    await loadWeekSummary();
    await loadSelectedDay();
  } catch (err) {
    console.error('Ошибка сохранения записи:', err);
  }
}

// Удаление записи
// Повторяющаяся запись: что удалять — только эту, эту и все следующие или всю серию
function chooseSeriesDeleteScope(callback) {
  const options = [
    { id: 'this', text: 'Только эту запись' },
    { id: 'following', text: 'Эту и все следующие' },
    { id: 'all', text: 'Всю серию' },
  ];
  if (tg?.showPopup && (!tg.isVersionAtLeast || tg.isVersionAtLeast('6.2'))) {
    tg.showPopup(
      {
        title: 'Повторяющаяся запись',
        message: 'Что удалить?',
        buttons: options.map((o) => ({ id: o.id, type: o.id === 'all' ? 'destructive' : 'default', text: o.text })),
      },
      (id) => callback(id || null),
    );
    return;
  }
  const answer = window.prompt('Что удалить?\n1 — только эту запись\n2 — эту и все следующие\n3 — всю серию', '1');
  callback({ 1: 'this', 2: 'following', 3: 'all' }[String(answer || '').trim()] || null);
}

async function runDeleteAppointment(id, scope) {
  try {
    const query = scope && scope !== 'this' ? `?scope=${scope}` : '';
    const res = await api(`/appointments/${id}${query}`, { method: 'DELETE' });
    haptic('success');
    showToast(res?.deleted > 1 ? `Удалено записей: ${res.deleted}` : 'Запись удалена');
    goScreen('main');
    await loadWeekSummary();
    await loadSelectedDay();
  } catch (err) {
    console.error('Ошибка удаления записи:', err);
  }
}

async function deleteAppointment() {
  const id = state.editingAppointmentId;
  if (!id) return;
  if (state.editingSeries) {
    chooseSeriesDeleteScope((scope) => {
      if (scope) runDeleteAppointment(id, scope);
    });
    return;
  }
  confirmDialog('Удалить эту запись безвозвратно?', (confirmed) => {
    if (confirmed) runDeleteAppointment(id, 'this');
  });
}

document.getElementById('btn-quick-tomorrow')?.addEventListener('click', () => {
  const dateInput = document.getElementById('form-appt-date');
  if (!dateInput || !dateInput.value) return;
  haptic('medium');
  dateInput.value = addDays(dateInput.value, 1);
  showToast('Дата сдвинута на +1 день ⏩');
  checkConflicts();
});
document.getElementById('btn-submit-appt')?.addEventListener('click', saveAppointment);
document.getElementById('btn-delete-appt')?.addEventListener('click', deleteAppointment);
document.getElementById('btn-cancel-appt')?.addEventListener('click', () => goScreen('main'));
document.getElementById('btn-add-appt')?.addEventListener('click', () => {
  haptic('light');
  openForm(null);
});
