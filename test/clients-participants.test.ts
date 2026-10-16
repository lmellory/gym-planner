// Этап 2: переименование клиента не теряет историю; участники сплита и группы получают отдельные записи.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PARTICIPANTS, cleanParticipants } from '../src/api/appointments';
import { api, createTestDb, makeEnv, NOW, OTHER, OWNER, stubTelegram } from './helpers/harness';

let env: any;
let closeDb: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const t = await createTestDb();
  closeDb = t.close;
  env = makeEnv(t.db);
  stubTelegram();
});
afterEach(() => {
  closeDb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const appt = (o: Record<string, unknown> = {}) => ({ date: '2026-10-14', start_time: '10:00', client_name: 'Инна', service: 'personal', ...o });
const add = (o: Record<string, unknown> = {}, user = OWNER) => api(env, user, 'POST', '/api/appointments', appt(o));
const list = async (user = OWNER) =>
  (await api(env, user, 'GET', '/api/appointments?from=2026-10-01&to=2026-10-31')).json as any[];
const clientsOf = async (user = OWNER) => (await api(env, user, 'GET', '/api/clients')).json as any[];
const clientId = async (name: string, user = OWNER) => (await clientsOf(user)).find((c) => c.name === name).id as number;

describe('переименование клиента', () => {
  it('имя меняется во всех его записях и в истории; чужие записи с тем же именем не затронуты', async () => {
    await add({ date: '2026-10-12' });
    await add({ date: '2026-10-14' });
    await add({ date: '2026-10-15', client_name: 'Мария' });
    await add({ client_name: 'Инна' }, OTHER);
    const id = await clientId('Инна');

    const r = await api(env, OWNER, 'PUT', `/api/clients/${id}`, { name: 'Инна Петрова', phone: '+37360000000' });
    expect(r.status).toBe(200);

    const mine = await list();
    expect(mine.filter((a) => a.client_name === 'Инна Петрова')).toHaveLength(2);
    expect(mine.some((a) => a.client_name === 'Инна')).toBe(false);
    expect(mine.find((a) => a.client_name === 'Мария')).toBeTruthy();
    expect((await list(OTHER)).map((a) => a.client_name)).toEqual(['Инна']);

    const card = (await api(env, OWNER, 'GET', `/api/clients/${id}`)).json;
    expect(card.client.name).toBe('Инна Петрова');
    expect(card.client.phone).toBe('+37360000000');
    expect(card.history).toHaveLength(2);
    expect((await clientsOf()).map((c) => c.name)).not.toContain('Инна');
  });

  it('правка контактов без смены имени записи не трогает', async () => {
    await add();
    const id = await clientId('Инна');
    expect((await api(env, OWNER, 'PUT', `/api/clients/${id}`, { name: 'Инна', notes: 'колено' })).status).toBe(200);
    expect((await list()).map((a) => a.client_name)).toEqual(['Инна']);
  });

  it('имя уже занято другим клиентом — 409, ничего не меняется', async () => {
    await add();
    await add({ client_name: 'Мария', start_time: '12:00' });
    const id = await clientId('Инна');
    const r = await api(env, OWNER, 'PUT', `/api/clients/${id}`, { name: 'Мария' });
    expect(r.status).toBe(409);
    expect(r.json.error).toContain('уже есть');
    expect((await list()).map((a) => a.client_name).sort()).toEqual(['Инна', 'Мария']);
    expect((await clientsOf()).map((c) => c.name).sort()).toEqual(['Инна', 'Мария']);
  });

  it('несуществующий клиент и клиент другого тренера — 404', async () => {
    await add({}, OTHER);
    const otherId = await clientId('Инна', OTHER);
    expect((await api(env, OWNER, 'PUT', `/api/clients/${otherId}`, { name: 'Взлом' })).status).toBe(404);
    expect((await api(env, OWNER, 'PUT', '/api/clients/99999', { name: 'Никто' })).status).toBe(404);
    expect((await list(OTHER)).map((a) => a.client_name)).toEqual(['Инна']);
  });
});

describe('cleanParticipants', () => {
  it('убирает пустые, лишние пробелы и повторы (без учёта регистра, включая основного клиента)', () => {
    expect(cleanParticipants([' Олег ', 'олег', '', 'Мария  Ивановна', 'инна', null], 'Инна', 'split')).toEqual([['Олег', 'Мария Ивановна'], null]);
  });
  it('нет списка — пустой результат; не массив — ошибка', () => {
    expect(cleanParticipants(undefined, 'Инна', 'group')).toEqual([[], null]);
    expect(cleanParticipants('Олег', 'Инна', 'group')[1]).toContain('список');
  });
  it('только для сплита и группы; лимит участников', () => {
    expect(cleanParticipants(['Олег'], 'Инна', 'personal')[1]).toContain('сплита и группового');
    expect(cleanParticipants([], 'Инна', 'personal')).toEqual([[], null]);
    const many = Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, i) => `Клиент ${i}`);
    expect(cleanParticipants(many, 'Инна', 'group')[1]).toContain(String(MAX_PARTICIPANTS));
  });
});

describe('участники сплита и группы', () => {
  it('каждому участнику создаётся своя запись на то же время; клиенты заводятся в базе', async () => {
    const r = await add({ service: 'split', price: 700, comment: 'ноги', who: 'из зала', participants: ['Олег', 'олег', ' Мария '] });
    expect(r.status).toBe(201);
    expect(r.json.ids).toHaveLength(3);
    expect(r.json.id).toBe(r.json.ids[0]);

    const rows = await list();
    expect(rows.map((a) => a.client_name).sort()).toEqual(['Инна', 'Мария', 'Олег']);
    for (const a of rows) {
      expect(a).toMatchObject({ date: '2026-10-14', start_time: '10:00', service: 'split', price: 700, comment: 'ноги', who: 'из зала', status: 'scheduled' });
    }
    expect((await clientsOf()).map((c) => c.name)).toEqual(expect.arrayContaining(['Инна', 'Мария', 'Олег']));
  });

  it('записи одной группы друг другу не конфликтуют, чужие — да', async () => {
    await add({ client_name: 'Борис', start_time: '10:30' });
    const r = await add({ service: 'group', participants: ['Олег', 'Мария'] });
    expect(r.status).toBe(201);
    expect(r.json.conflicts.map((c: any) => c.client_name)).toEqual(['Борис']);
  });

  it('без participants создаётся одна запись, как раньше', async () => {
    const r = await add({ service: 'group' });
    expect(r.status).toBe(201);
    expect(r.json.ids).toHaveLength(1);
    expect(await list()).toHaveLength(1);
  });

  it('для персональной тренировки и при кривом списке — 400, ничего не создаётся', async () => {
    expect((await add({ service: 'personal', participants: ['Олег'] })).status).toBe(400);
    expect((await add({ service: 'split', participants: 'Олег' })).status).toBe(400);
    expect((await add({ service: 'group', participants: Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, i) => `К${i}`) })).status).toBe(400);
    expect(await list()).toHaveLength(0);
  });

  it('о своей групповой записи тренер сообщений не получает', async () => {
    const calls = stubTelegram();
    const r = await add({ service: 'split', participants: ['Олег'] });
    expect(r.status).toBe(201);
    expect(calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0);
  });
});
