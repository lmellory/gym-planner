// ===== 9. ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====

/** Подпись валюты берём из настроек тренера (в режиме «правка за тренера» — его настройки). */
async function loadCurrency() {
  const s = await api('/settings');
  CURRENCY = s.currency || DEFAULT_CURRENCY;
}

async function init() {
  updateGreeting();
  goScreen('main');
  loadMe().catch(() => {});
  loadCurrency().catch(() => {});
  loadClientsDatalist().catch(() => {});
  loadPrices().catch(() => {});
  await loadWeekSummary();
  await loadSelectedDay();
}

init();

