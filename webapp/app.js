// ===== 9. ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====

/** Настройки тренера: валюта, рабочий график (окна в расписании), время уведомлений. */
async function loadSettings() {
  const s = await api('/settings');
  state.settings = s;
  CURRENCY = s.currency || DEFAULT_CURRENCY;
  if (state.currentScreen === 'main') {
    renderAppointmentsList();
  }
}

async function init() {
  updateGreeting();
  goScreen('main');
  loadMe().catch(() => {});
  loadSettings().catch(() => {});
  loadClientsDatalist().catch(() => {});
  loadPrices().catch(() => {});
  await loadWeekSummary();
  await loadSelectedDay();
}

init();

