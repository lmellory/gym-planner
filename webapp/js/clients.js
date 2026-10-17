// ===== 8. БАЗА КЛИЕНТОВ =====

let cachedClients = [];
let currentViewingClientId = null;
let currentMemberships = [];

async function loadClientsDatalist() {
  try {
    cachedClients = await api('/clients');
    const dl = document.getElementById('clients-datalist');
    if (!dl) return;
    dl.innerHTML = '';
    for (const c of cachedClients) {
      const opt = document.createElement('option');
      opt.value = c.name;
      if (c.phone) opt.label = c.phone;
      dl.appendChild(opt);
    }
  } catch (e) {
    console.error('Ошибка обновления подсказок клиентов', e);
  }
}

async function loadClients(search = '') {
  const listEl = document.getElementById('clients-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading-spinner">Загрузка клиентов…</div>';

  try {
    cachedClients = await api(`/clients?q=${encodeURIComponent(search)}`);
    renderClientsList(cachedClients);
  } catch (err) {
    console.error('Ошибка загрузки клиентов:', err);
    listEl.innerHTML = '<div class="empty-state"><p>Ошибка загрузки клиентов</p></div>';
  }
}

const MONTH_NAMES_RU = [
  '', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

function formatBirthdayRu(ddmm) {
  if (!ddmm) return '';
  const [d, m] = ddmm.split('.');
  const day = Number(d);
  const month = Number(m);
  if (!day || !month || !MONTH_NAMES_RU[month]) return ddmm;
  return `${day} ${MONTH_NAMES_RU[month]}`;
}

function isBirthdayToday(ddmm) {
  if (!ddmm) return false;
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return ddmm === `${d}.${m}`;
}

function initBirthdaySelectors() {
  const daySelect = document.getElementById('edit-client-bday-day');
  if (!daySelect || daySelect.options.length > 1) return;
  for (let i = 1; i <= 31; i++) {
    const opt = document.createElement('option');
    const val = String(i).padStart(2, '0');
    opt.value = val;
    opt.textContent = i;
    daySelect.appendChild(opt);
  }
}

document.getElementById('btn-clear-bday')?.addEventListener('click', () => {
  const d = document.getElementById('edit-client-bday-day');
  const m = document.getElementById('edit-client-bday-month');
  if (d) d.value = '';
  if (m) m.value = '';
});

function renderClientsList(items) {
  const listEl = document.getElementById('clients-list');
  if (!listEl) return;

  if (!items || !items.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <img src="/assets/empty-clients.png" class="empty-state-img" alt="">
        <div class="empty-state-title">Клиентов пока нет</div>
        <p>Нажмите «+ Новый», чтобы добавить клиента в базу</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  for (const c of items) {
    const card = document.createElement('div');
    card.className = 'client-card';

    const contacts = [];
    if (c.phone) contacts.push(`📞 ${escapeHtml(c.phone)}`);
    if (c.telegram) contacts.push(`💬 @${escapeHtml(c.telegram.replace(/^@/, ''))}`);
    if (c.last_visit) contacts.push(`Посл. визит: ${c.last_visit}`);

    let bdayHtml = '';
    if (c.birthday) {
      if (isBirthdayToday(c.birthday)) {
        bdayHtml = `<span class="client-card-bday today">🎉 Сегодня ДР!</span>`;
      } else {
        bdayHtml = `<span class="client-card-bday">🎂 ${formatBirthdayRu(c.birthday)}</span>`;
      }
    }

    const noteHtml = c.notes ? `<div class="client-card-note">💡 ${escapeHtml(c.notes)}</div>` : '';

    card.innerHTML = `
      <div class="client-card-top">
        <span class="client-card-name">${escapeHtml(c.name)} ${bdayHtml}</span>
        <span class="client-card-visits">${c.appointments_count || 0} виз.</span>
      </div>
      <div class="client-card-contacts">${contacts.join(' · ') || 'Контакты не указаны'}</div>
      ${noteHtml}
    `;

    card.addEventListener('click', () => {
      haptic('light');
      openClientView(c.id);
    });

    listEl.appendChild(card);
  }
}

async function openClientView(id) {
  currentViewingClientId = id;
  const modal = document.getElementById('modal-client-view');
  const nameEl = document.getElementById('modal-client-name');
  const bdayRow = document.getElementById('client-view-bday-row');
  const bdayText = document.getElementById('client-view-bday-text');
  const phoneRow = document.getElementById('client-view-phone-row');
  const phoneLink = document.getElementById('client-view-phone-link');
  const tgRow = document.getElementById('client-view-tg-row');
  const tgLink = document.getElementById('client-view-tg-link');
  const notesBox = document.getElementById('client-view-notes-box');
  const notesText = document.getElementById('client-view-notes-text');
  const historyCount = document.getElementById('client-history-count');
  const historyList = document.getElementById('client-history-list');

  try {
    const data = await api(`/clients/${id}`);
    const client = data.client;
    const history = data.history || [];

    if (nameEl) nameEl.textContent = client.name;

    if (client.birthday && bdayRow && bdayText) {
      bdayRow.style.display = 'flex';
      if (isBirthdayToday(client.birthday)) {
        bdayText.className = 'client-view-bday-badge today';
        bdayText.textContent = `🎉 Сегодня день рождения! (${formatBirthdayRu(client.birthday)})`;
      } else {
        bdayText.className = 'client-view-bday-badge';
        bdayText.textContent = `День рождения: ${formatBirthdayRu(client.birthday)}`;
      }
    } else if (bdayRow) {
      bdayRow.style.display = 'none';
    }

    if (client.phone && phoneRow && phoneLink) {
      phoneRow.style.display = 'flex';
      phoneLink.textContent = client.phone;
      phoneLink.href = `tel:${client.phone}`;
    } else if (phoneRow) {
      phoneRow.style.display = 'none';
    }

    if (client.telegram && tgRow && tgLink) {
      const cleanTg = client.telegram.replace(/^@/, '');
      tgRow.style.display = 'flex';
      tgLink.textContent = `@${cleanTg}`;
      tgLink.href = `https://t.me/${cleanTg}`;
      // Внутри Telegram обычный <a> на iOS может не открыться — ведём через WebApp API
      tgLink.onclick = (ev) => {
        ev.preventDefault();
        openExternal(`https://t.me/${cleanTg}`);
      };
    } else if (tgRow) {
      tgRow.style.display = 'none';
    }

    if (client.notes && notesBox && notesText) {
      notesBox.style.display = 'block';
      notesText.textContent = client.notes;
    } else if (notesBox) {
      notesBox.style.display = 'none';
    }

    if (historyCount) historyCount.textContent = `${history.length}`;
    if (historyList) {
      if (!history.length) {
        historyList.innerHTML = '<div style="color: var(--hint-color); font-size: 13px;">Записей пока нет</div>';
      } else {
        historyList.innerHTML = '';
        for (const a of history) {
          const item = document.createElement('div');
          item.className = 'history-item';
          const sRu = serviceRu(a.service);
          item.innerHTML = `
            <span><b>${a.date}</b> (${formatApptTime(a)}) · ${sRu}</span>
            ${a.comment ? `<span style="color: var(--hint-color);">💬</span>` : ''}
          `;
          historyList.appendChild(item);
        }
      }
    }

    renderMembershipList(data.memberships || []);

    if (modal) modal.style.display = 'flex';
  } catch (err) {
    console.error('Ошибка загрузки карточки клиента:', err);
  }
}

// ===== Абонементы в карточке клиента =====
const MEMBERSHIP_STATE_RU = { active: 'действует', finished: 'занятия закончились', expired: 'срок истёк', upcoming: 'ещё не началась' };

function renderMembershipList(items) {
  currentMemberships = items;
  const list = document.getElementById('client-membership-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div style="color: var(--hint-color); font-size: 13px; margin-top: 6px;">Абонементов пока нет</div>';
    return;
  }
  list.innerHTML = '';
  for (const m of items) {
    const stateCls = m.state === 'active' ? 'is-active' : m.state === 'upcoming' ? '' : 'is-warn';
    const term = m.expires_on ? `с ${ruDate(m.start_date)} до ${ruDate(m.expires_on)}` : `с ${ruDate(m.start_date)}, бессрочный`;
    const price = m.price !== null && m.price !== undefined ? formatMoney(m.price) : 'цена не указана';
    const planned = m.planned ? ` · записано вперёд: ${m.planned}` : '';

    const el = document.createElement('div');
    el.className = 'membership-item';
    el.innerHTML = `
      <div class="membership-item-top">
        <span class="membership-item-title">${m.sessions} ${plural(m.sessions, 'занятие', 'занятия', 'занятий')} · осталось ${m.remaining}</span>
        <span class="membership-state ${stateCls}">${MEMBERSHIP_STATE_RU[m.state] || ''}</span>
      </div>
      <div class="membership-item-meta">${term} · ${price}${planned}</div>
      <div class="membership-item-note membership-item-meta"></div>
      <div class="membership-item-actions">
        <button type="button" data-act="edit">✏️ Изменить</button>
        <button type="button" data-act="delete">🗑 Удалить</button>
      </div>
    `;
    const noteEl = el.querySelector('.membership-item-note');
    if (m.note) noteEl.textContent = `💬 ${m.note}`;
    else noteEl.remove();
    el.querySelector('[data-act="edit"]').addEventListener('click', () => openMembershipEdit(m));
    el.querySelector('[data-act="delete"]').addEventListener('click', () => deleteMembershipItem(m));
    list.appendChild(el);
  }
}

function openMembershipEdit(m = null) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  document.getElementById('modal-membership-title').textContent = m ? 'Изменить абонемент' : 'Новый абонемент';
  set('edit-membership-id', m ? m.id : '');
  set('edit-membership-sessions', m ? m.sessions : '');
  set('edit-membership-price', m && m.price !== null ? m.price : '');
  set('edit-membership-start', m ? m.start_date : todayStr);
  set('edit-membership-expires', m && m.expires_on ? m.expires_on : '');
  set('edit-membership-note', m && m.note ? m.note : '');
  document.getElementById('modal-membership-edit').style.display = 'flex';
}

function closeMembershipEdit() {
  const modal = document.getElementById('modal-membership-edit');
  if (modal) modal.style.display = 'none';
}

async function saveMembership() {
  const val = (id) => document.getElementById(id)?.value?.trim() ?? '';
  const id = val('edit-membership-id');
  const sessions = Number(val('edit-membership-sessions'));
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 1000) return showToast('Укажите число занятий (от 1 до 1000)');

  const priceRaw = val('edit-membership-price');
  let price = null;
  if (priceRaw !== '') {
    price = Number(priceRaw);
    if (!Number.isInteger(price) || price < 0) return showToast('Цена — целое число, например 8000');
  }
  const start_date = val('edit-membership-start');
  if (!start_date) return showToast('Укажите дату продажи');
  const expires_on = val('edit-membership-expires') || null;
  if (expires_on && expires_on < start_date) return showToast('Срок действия не может закончиться раньше продажи');
  const note = val('edit-membership-note') || null;

  try {
    if (id) {
      await api(`/memberships/${id}`, { method: 'PUT', body: JSON.stringify({ sessions, price, start_date, expires_on, note }) });
      showToast('Абонемент обновлён ✅');
    } else {
      await api('/memberships', {
        method: 'POST',
        body: JSON.stringify({ client_id: currentViewingClientId, sessions, price, start_date, expires_on, note }),
      });
      showToast('Абонемент добавлен ✅');
    }
    haptic('success');
    closeMembershipEdit();
    await openClientView(currentViewingClientId);
  } catch (err) {
    console.error('Ошибка сохранения абонемента:', err);
  }
}

function deleteMembershipItem(m) {
  confirmDialog(`Удалить абонемент на ${m.sessions} ${plural(m.sessions, 'занятие', 'занятия', 'занятий')}? Занятия клиента останутся, но перестанут списываться с него.`, async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/memberships/${m.id}`, { method: 'DELETE' });
      haptic('success');
      showToast('Абонемент удалён');
      await openClientView(currentViewingClientId);
    } catch (err) {
      console.error('Ошибка удаления абонемента:', err);
    }
  });
}

document.getElementById('btn-membership-add')?.addEventListener('click', () => {
  haptic('light');
  openMembershipEdit(null);
});
document.getElementById('btn-save-membership')?.addEventListener('click', saveMembership);
document.getElementById('btn-close-membership-edit')?.addEventListener('click', closeMembershipEdit);
document.getElementById('btn-cancel-membership-edit')?.addEventListener('click', closeMembershipEdit);

function closeClientView() {
  const modal = document.getElementById('modal-client-view');
  if (modal) modal.style.display = 'none';
}

function openClientEdit(client = null) {
  closeClientView();
  initBirthdaySelectors();

  const modal = document.getElementById('modal-client-edit');
  const title = document.getElementById('modal-client-edit-title');
  const idInput = document.getElementById('edit-client-id');
  const nameInput = document.getElementById('edit-client-name');
  const bdayDay = document.getElementById('edit-client-bday-day');
  const bdayMonth = document.getElementById('edit-client-bday-month');
  const phoneInput = document.getElementById('edit-client-phone');
  const tgInput = document.getElementById('edit-client-tg');
  const notesInput = document.getElementById('edit-client-notes');

  if (client) {
    if (title) title.textContent = 'Редактировать клиента';
    if (idInput) idInput.value = client.id;
    if (nameInput) nameInput.value = client.name;
    if (phoneInput) phoneInput.value = client.phone || '';
    if (tgInput) tgInput.value = client.telegram || '';
    if (notesInput) notesInput.value = client.notes || '';

    if (client.birthday) {
      const [d, m] = client.birthday.split('.');
      if (bdayDay) bdayDay.value = d || '';
      if (bdayMonth) bdayMonth.value = m || '';
    } else {
      if (bdayDay) bdayDay.value = '';
      if (bdayMonth) bdayMonth.value = '';
    }
  } else {
    if (title) title.textContent = 'Новый клиент';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (tgInput) tgInput.value = '';
    if (notesInput) notesInput.value = '';
    if (bdayDay) bdayDay.value = '';
    if (bdayMonth) bdayMonth.value = '';
  }

  if (modal) modal.style.display = 'flex';
  setTimeout(() => nameInput?.focus(), 100);
}

function closeClientEdit() {
  const modal = document.getElementById('modal-client-edit');
  if (modal) modal.style.display = 'none';
}

async function saveClientModal() {
  const id = document.getElementById('edit-client-id')?.value;
  const name = document.getElementById('edit-client-name')?.value?.trim();
  const phone = document.getElementById('edit-client-phone')?.value?.trim() || null;
  const telegram = document.getElementById('edit-client-tg')?.value?.trim() || null;
  const notes = document.getElementById('edit-client-notes')?.value?.trim() || null;

  const bdayDay = document.getElementById('edit-client-bday-day')?.value;
  const bdayMonth = document.getElementById('edit-client-bday-month')?.value;
  let birthday = null;
  if (bdayDay && bdayMonth) {
    birthday = `${bdayDay}.${bdayMonth}`;
  } else if (bdayDay || bdayMonth) {
    return showToast('Укажите и день, и месяц рождения');
  }

  if (!name) return showToast('Укажите имя клиента');

  try {
    if (id) {
      await api(`/clients/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, phone, telegram, notes, birthday }),
      });
      showToast('Клиент обновлён ✅');
    } else {
      await api('/clients', {
        method: 'POST',
        body: JSON.stringify({ name, phone, telegram, notes, birthday }),
      });
      showToast('Клиент добавлен ✅');
    }

    haptic('success');
    closeClientEdit();
    await loadClients();
    await loadClientsDatalist();
  } catch (err) {
    console.error('Ошибка сохранения клиента:', err);
  }
}

async function deleteClientModal() {
  if (!currentViewingClientId) return;
  confirmDialog('Удалить этого клиента из базы?', async (confirmed) => {
    if (!confirmed) return;
    try {
      await api(`/clients/${currentViewingClientId}`, { method: 'DELETE' });
      haptic('success');
      showToast('Клиент удалён');
      closeClientView();
      await loadClients();
      await loadClientsDatalist();
    } catch (err) {
      console.error('Ошибка удаления клиента:', err);
    }
  });
}

// Поиск клиентов в реальном времени
let clientSearchDebounce = null;
document.getElementById('input-clients-search')?.addEventListener('input', (e) => {
  clearTimeout(clientSearchDebounce);
  const q = e.target.value;
  clientSearchDebounce = setTimeout(() => {
    loadClients(q);
  }, 250);
});
