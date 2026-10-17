// ===== 6. ЗАМЕТКА ДНЯ =====

function openNote() {
  const titleDate = document.getElementById('note-screen-date');
  const textarea = document.getElementById('note-text-input');

  if (titleDate) titleDate.textContent = formatFullDateRu(state.selectedDate);
  if (textarea) textarea.value = state.currentDayNote || '';

  goScreen('note');
  setTimeout(() => textarea?.focus(), 100);
}

async function saveDayNote() {
  const textarea = document.getElementById('note-text-input');
  const text = textarea?.value?.trim() || '';

  try {
    await api(`/notes/${state.selectedDate}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    });

    haptic('success');
    showToast(text ? 'Заметка сохранена 📝' : 'Заметка удалена');
    state.currentDayNote = text;

    goScreen('main');
    await loadWeekSummary();
    await loadSelectedDay();
  } catch (err) {
    console.error('Ошибка сохранения заметки:', err);
  }
}

function deleteDayNote() {
  confirmDialog('Очистить заметку на этот день?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/notes/${state.selectedDate}`, {
        method: 'PUT',
        body: JSON.stringify({ text: '' }),
      });
      haptic('success');
      showToast('Заметка очищена');
      state.currentDayNote = '';
      goScreen('main');
      await loadWeekSummary();
      await loadSelectedDay();
    } catch (err) {
      console.error('Ошибка удаления заметки:', err);
    }
  });
}

document.getElementById('btn-day-note-action')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
document.getElementById('btn-edit-note-card')?.addEventListener('click', () => {
  haptic('light');
  openNote();
});
document.getElementById('btn-delete-note')?.addEventListener('click', deleteDayNote);
document.getElementById('btn-cancel-note')?.addEventListener('click', () => goScreen('main'));

// ===== 7. НАСТРОЙКИ И ЭКСПОРТ =====

let selectedWorkDays = [1, 2, 3, 4, 5, 6];

function renderWorkDaysPicker() {
  document.querySelectorAll('#setting-work-days-picker .day-toggle-pill').forEach((btn) => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle('active', selectedWorkDays.includes(day));
  });
}

document.querySelectorAll('#setting-work-days-picker .day-toggle-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    haptic('light');
    const day = Number(btn.dataset.day);
    if (selectedWorkDays.includes(day)) {
      if (selectedWorkDays.length > 1) {
        selectedWorkDays = selectedWorkDays.filter((d) => d !== day);
      }
    } else {
      selectedWorkDays.push(day);
      selectedWorkDays.sort((a, b) => a - b);
    }
    renderWorkDaysPicker();
  });
});

async function openSettings() {
  loadPrices().catch(() => {});
  try {
    const s = await api('/settings');
    const enabledCheck = document.getElementById('setting-notify-enabled');
    const newApptCheck = document.getElementById('setting-notify-new-appt');
    const timeInput = document.getElementById('setting-notify-time');
    const tzSelect = document.getElementById('setting-tz');
    const workStart = document.getElementById('setting-work-start');
    const workEnd = document.getElementById('setting-work-end');

    const backupCheck = document.getElementById('setting-backup-enabled');
    const noteCheck = document.getElementById('setting-notify-note');
    const summaryCheck = document.getElementById('setting-notify-summary');
    const backupTime = document.getElementById('setting-backup-time');
    const birthdayTime = document.getElementById('setting-birthday-time');
    const currencyInput = document.getElementById('setting-currency');
    const coachInput = document.getElementById('setting-coach-name');
    const gymInput = document.getElementById('setting-gym-name');
    const buttonInput = document.getElementById('setting-button-label');
    const greetingInput = document.getElementById('setting-greeting');
    const styleSelect = document.getElementById('setting-notify-style');
    if (backupCheck) backupCheck.checked = s.backup_enabled !== false;
    if (noteCheck) noteCheck.checked = !!s.notify_note;
    if (summaryCheck) summaryCheck.checked = s.notify_summary !== false;
    if (backupTime) backupTime.value = s.backup_time || '21:00';
    if (birthdayTime) birthdayTime.value = s.birthday_time || '10:00';
    if (currencyInput) currencyInput.value = s.currency || '';
    if (coachInput) coachInput.value = s.coach_name || '';
    if (gymInput) gymInput.value = s.gym_name || '';
    if (buttonInput) buttonInput.value = s.button_label || '';
    if (greetingInput) greetingInput.value = s.greeting || '';
    if (styleSelect) styleSelect.value = s.notify_style === 'short' ? 'short' : 'full';
    if (enabledCheck) enabledCheck.checked = !!s.notify_enabled;
    if (newApptCheck) newApptCheck.checked = s.notify_new_appt !== false;
    if (timeInput) timeInput.value = s.notify_time || '22:00';
    if (workStart) workStart.value = s.work_start_time || '09:00';
    if (workEnd) workEnd.value = s.work_end_time || '20:00';

    if (s.work_days) {
      selectedWorkDays = s.work_days.split(',').map((x) => Number(x.trim())).filter(Boolean);
    } else {
      selectedWorkDays = [1, 2, 3, 4, 5, 6];
    }
    renderWorkDaysPicker();

    if (tzSelect && s.tz) {
      if (![...tzSelect.options].some((o) => o.value === s.tz)) {
        const opt = document.createElement('option');
        opt.value = s.tz;
        opt.textContent = s.tz;
        tzSelect.appendChild(opt);
      }
      tzSelect.value = s.tz;
    }
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
  }
  goScreen('settings');
}

async function saveSettings() {
  const notify_enabled = !!document.getElementById('setting-notify-enabled')?.checked;
  const notify_new_appt = !!document.getElementById('setting-notify-new-appt')?.checked;
  const notify_time = document.getElementById('setting-notify-time')?.value || '22:00';
  const tz = document.getElementById('setting-tz')?.value || 'Europe/Chisinau';
  const work_start_time = document.getElementById('setting-work-start')?.value || '09:00';
  const work_end_time = document.getElementById('setting-work-end')?.value || '20:00';
  const work_days = selectedWorkDays.join(',');
  const backup_enabled = !!document.getElementById('setting-backup-enabled')?.checked;
  const notify_note = !!document.getElementById('setting-notify-note')?.checked;
  const notify_summary = !!document.getElementById('setting-notify-summary')?.checked;
  const backup_time = document.getElementById('setting-backup-time')?.value || '21:00';
  const birthday_time = document.getElementById('setting-birthday-time')?.value || '10:00';
  const currency = (document.getElementById('setting-currency')?.value || '').trim();
  const coach_name = (document.getElementById('setting-coach-name')?.value || '').trim();
  const gym_name = (document.getElementById('setting-gym-name')?.value || '').trim();
  const button_label = (document.getElementById('setting-button-label')?.value || '').trim();
  const greeting = (document.getElementById('setting-greeting')?.value || '').trim();
  const notify_style = document.getElementById('setting-notify-style')?.value === 'short' ? 'short' : 'full';

  try {
    const saved = await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({
        notify_enabled,
        notify_time,
        tz,
        notify_new_appt,
        notify_note,
        notify_summary,
        work_start_time,
        work_end_time,
        work_days,
        backup_enabled,
        backup_time,
        birthday_time,
        currency,
        coach_name,
        gym_name,
        button_label,
        greeting,
        notify_style,
      }),
    });
    CURRENCY = saved.currency || DEFAULT_CURRENCY;
    haptic('success');
    showToast('Настройки сохранены ✅');
  } catch (err) {
    console.error('Ошибка сохранения настроек:', err);
  }
}

// ===== ВОССТАНОВЛЕНИЕ ИЗ РЕЗЕРВНОЙ КОПИИ =====
async function restoreFromFile(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return showToast('Файл не похож на резервную копию');
  }
  let preview;
  try {
    preview = await api('/import', { method: 'POST', body: JSON.stringify({ backup }) }); // только проверка
  } catch {
    return; // api() уже показал причину
  }
  const r = preview.report;
  const skipped = r.appointments.skipped + r.clients.skipped + (r.memberships?.skipped || 0) + r.expenses.skipped + r.day_notes.skipped;
  const message =
    `Восстановить из копии?\n\nЗаписей: ${r.appointments.ok}\nКлиентов: ${r.clients.ok}` +
    (r.memberships?.ok ? `\nАбонементов: ${r.memberships.ok}` : '') +
    `\nТрат: ${r.expenses.ok}\nЗаметок: ${r.day_notes.ok}` +
    (skipped ? `\nПропущено повреждённых строк: ${skipped}` : '') +
    `\n\nВсе текущие данные будут заменены.`;
  confirmDialog(message, async (confirmed) => {
    if (!confirmed) return;
    try {
      await api('/import', { method: 'POST', body: JSON.stringify({ backup, confirm: true }) });
      haptic('success');
      showToast('Данные восстановлены ✅');
      await Promise.all([loadWeekSummary(), loadSelectedDay(), loadClientsDatalist().catch(() => {}), loadPrices().catch(() => {})]);
      await openSettings();
    } catch (err) {
      console.error('Ошибка восстановления:', err);
    }
  });
}

document.getElementById('btn-restore-backup')?.addEventListener('click', () => {
  haptic('light');
  document.getElementById('restore-file-input')?.click();
});
document.getElementById('restore-file-input')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  e.target.value = ''; // чтобы тот же файл можно было выбрать повторно
  if (file) restoreFromFile(file);
});

// ===== ПРАЙС УСЛУГ =====
const PRICE_SERVICES = Object.keys(SERVICE_RU);

function applyPricesToInputs() {
  for (const s of PRICE_SERVICES) {
    const el = document.getElementById(`setting-price-${s}`);
    if (el) el.value = state.prices[s] ?? '';
  }
}

async function loadPrices() {
  state.prices = await api('/prices');
  applyPricesToInputs();
}

async function savePrices() {
  const body = {};
  for (const s of PRICE_SERVICES) {
    const el = document.getElementById(`setting-price-${s}`);
    if (el?.validity?.badInput) return showToast('Цена — целое число, например 800');
    const raw = el?.value?.trim() ?? '';
    if (raw === '') { body[s] = null; continue; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return showToast('Цена — целое число, например 800');
    body[s] = n;
  }
  try {
    state.prices = await api('/prices', { method: 'PUT', body: JSON.stringify(body) });
    applyPricesToInputs();
    haptic('success');
    showToast('Прайс сохранён ✅');
  } catch (err) {
    console.error('Ошибка сохранения прайса:', err);
  }
}

async function exportFinance() {
  haptic('light');
  showToast('Формируем файл и отправляем в чат…');
  try {
    const res = await api('/export/finance', {
      method: 'POST',
      body: JSON.stringify({ period: income.period, date: income.anchor }),
    });
    if (res.ok) {
      haptic('success');
      showToast('📊 CSV за период отправлен в чат!');
    }
  } catch (err) {
    console.error('Ошибка выгрузки доходов:', err);
  }
}

async function exportData(format = 'csv') {
  haptic('light');
  showToast('Формируем и отправляем файл в чат…');
  try {
    const res = await api('/export/send', {
      method: 'POST',
      body: JSON.stringify({ format }),
    });
    if (res.ok) {
      haptic('success');
      showToast(format === 'csv' ? '📊 CSV-файл отправлен ботом в чат!' : '💾 Резервная копия JSON отправлена в чат!');
    }
  } catch (err) {
    console.error('Ошибка экспорта:', err);
  }
}

document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
document.getElementById('btn-export-csv')?.addEventListener('click', () => exportData('csv'));
document.getElementById('btn-export-json')?.addEventListener('click', () => exportData('json'));
document.getElementById('btn-save-prices')?.addEventListener('click', savePrices);
document.getElementById('btn-export-finance')?.addEventListener('click', exportFinance);
