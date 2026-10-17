// ===== 8. АДМИН-ПАНЕЛЬ =====
// Администратор выбирает тренера и дальше работает с обычным расписанием этого тренера: добавляет, меняет,
// удаляет записи. Каждый запрос уходит с заголовком X-Act-As (см. api()); сервер проверяет права и пускает
// только к записям. Пока режим включён, доходы, клиенты, настройки и заметки скрыты.

async function loadMe() {
  try {
    const me = await api('/me');
    state.isAdmin = !!me.is_admin;
  } catch {
    state.isAdmin = false;
  }
  const btn = document.getElementById('btn-open-admin');
  if (btn) btn.style.display = state.isAdmin ? '' : 'none';
}

function trainerLabel(m) {
  return m.name || (m.username ? '@' + m.username : 'ID ' + m.user_id);
}

function renderAdminTrainers(trainers) {
  const list = document.getElementById('admin-trainers-list');
  if (!list) return;
  if (!trainers.length) {
    list.innerHTML = '<div class="empty-state">Тренеров пока нет</div>';
    return;
  }
  list.innerHTML = trainers
    .map((m) => {
      const badge = m.banned
        ? '<span class="admin-badge is-banned">заблокирован</span>'
        : !m.has_access
          ? '<span class="admin-badge">нет доступа</span>'
          : '';
      const last = m.last_appointment ? ` · последняя запись ${escapeHtml(m.last_appointment)}` : '';
      return `
        <div class="client-card admin-trainer-card" data-id="${m.user_id}">
          <div class="client-card-top">
            <div class="client-card-name">${escapeHtml(trainerLabel(m))} ${badge}</div>
            <div class="client-card-visits">${m.appointments}</div>
          </div>
          <div class="client-card-contacts">${m.username ? '@' + escapeHtml(m.username) + ' · ' : ''}ID ${m.user_id}</div>
          <div class="client-card-note">Записей: ${m.appointments}, впереди: ${m.upcoming}, клиентов: ${m.clients}${last}</div>
          <div style="margin-top: 10px;">
            <button type="button" class="btn btn-secondary btn-small" data-personal="${m.user_id}">🎨 Персонализация</button>
          </div>
        </div>`;
    })
    .join('');
  list.querySelectorAll('.admin-trainer-card').forEach((el) => {
    el.addEventListener('click', () => {
      const m = trainers.find((x) => String(x.user_id) === el.dataset.id);
      if (m) enterActAs(m);
    });
  });
  list.querySelectorAll('[data-personal]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation(); // иначе откроется режим «правка за тренера»
      const m = trainers.find((x) => String(x.user_id) === btn.dataset.personal);
      if (m) openTrainerPersonal(m.user_id, trainerLabel(m));
    });
  });
}

async function openAdmin() {
  goScreen('admin');
  const list = document.getElementById('admin-trainers-list');
  if (list) list.innerHTML = '<div class="empty-state">Загрузка…</div>';
  try {
    const data = await api('/admin/trainers');
    renderAdminTrainers(data.trainers || []);
  } catch {
    if (list) list.innerHTML = '<div class="empty-state">Не удалось загрузить список тренеров</div>';
  }
}

/** Перечитывает всё, что зависит от «чьи данные»: расписание, подсказки клиентов, прайс. */
async function reloadScheduleData() {
  state.appointments = [];
  state.daySummaryMap = new Map();
  state.prices = {};
  state.selectedDate = todayStr;
  state.weekStart = fmt(mondayOf(new Date()));
  loadClientsDatalist().catch(() => {});
  loadPrices().catch(() => {});
  await loadWeekSummary();
  await loadSelectedDay();
}

function setActAsUI(on) {
  document.body.classList.toggle('acting-as', on);
  const banner = document.getElementById('act-as-banner');
  const label = document.getElementById('act-as-label');
  if (label) label.textContent = on ? state.actAsLabel : '';
  if (banner) banner.style.display = on ? 'flex' : 'none';
}

async function enterActAs(trainer) {
  haptic('medium');
  state.actAs = trainer.user_id;
  state.actAsLabel = trainerLabel(trainer);
  setActAsUI(true);
  goScreen('main');
  await reloadScheduleData();
}

async function exitActAs() {
  haptic('light');
  state.actAs = null;
  state.actAsLabel = '';
  setActAsUI(false);
  goScreen('main');
  await reloadScheduleData();
}

document.getElementById('btn-open-admin')?.addEventListener('click', () => {
  haptic('light');
  openAdmin();
});
document.getElementById('btn-act-as-exit')?.addEventListener('click', exitActAs);

// ===== Персонализация тренера (админ задаёт за тренера) =====
// Тренер этих полей в своих настройках не видит: имя, зал, приветствие и стиль расписания задаёт админ.
// Запросы идут с X-Act-As, поэтому api() правит данные выбранного тренера, а не администратора.
let personalTrainerId = 0;
let personalSettings = null;

function closeTrainerPersonal() {
  const modal = document.getElementById('modal-trainer-personal');
  if (modal) modal.style.display = 'none';
  personalTrainerId = 0;
  personalSettings = null;
}

async function openTrainerPersonal(userId, label) {
  const modal = document.getElementById('modal-trainer-personal');
  if (!modal) return;
  try {
    const s = await api('/settings', { headers: { 'X-Act-As': String(userId) } });
    personalTrainerId = userId;
    personalSettings = s;
    const title = document.getElementById('modal-trainer-personal-title');
    if (title) title.textContent = label;
    document.getElementById('personal-coach-name').value = s.coach_name || '';
    document.getElementById('personal-gym-name').value = s.gym_name || '';
    document.getElementById('personal-button-label').value = s.button_label || '';
    document.getElementById('personal-greeting').value = s.greeting || '';
    document.getElementById('personal-notify-style').value = s.notify_style === 'short' ? 'short' : 'full';
    modal.style.display = 'flex';
  } catch (err) {
    console.error('не удалось загрузить персонализацию', err);
    showToast('Не удалось загрузить персонализацию');
  }
}

async function saveTrainerPersonal() {
  if (!personalTrainerId || !personalSettings) return;
  const value = (id) => (document.getElementById(id)?.value || '').trim();
  const payload = {
    ...personalSettings,
    coach_name: value('personal-coach-name'),
    gym_name: value('personal-gym-name'),
    button_label: value('personal-button-label'),
    greeting: value('personal-greeting'),
    notify_style: document.getElementById('personal-notify-style')?.value === 'short' ? 'short' : 'full',
  };
  try {
    await api('/settings', {
      method: 'PUT',
      headers: { 'X-Act-As': String(personalTrainerId) },
      body: JSON.stringify(payload),
    });
    haptic('success');
    showToast('Персонализация сохранена ✅');
    closeTrainerPersonal();
  } catch (err) {
    console.error('не удалось сохранить персонализацию', err);
    showToast('Не удалось сохранить');
  }
}

document.getElementById('btn-close-trainer-personal')?.addEventListener('click', closeTrainerPersonal);
document.getElementById('btn-cancel-trainer-personal')?.addEventListener('click', closeTrainerPersonal);
document.getElementById('btn-save-trainer-personal')?.addEventListener('click', saveTrainerPersonal);

