// Этап 4: абонементы. Занятие списывается по факту — когда тренировка состоялась.
// В тестах «сегодня» = среда 2026-10-14; записи ставим на прошлые (12–13 октября) и будущие (16 октября) даты,
// чтобы результат не зависел от времени суток.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allocate, summarize, validateMembership, type ApptSlot, type MembershipRow } from '../src/lib/memberships';
import { coverageAdjustments, subtractRows } from '../src/lib/stats';
import { api, createTestDb, makeEnv, NOW, OTHER, OWNER, stubTelegram } from './helpers/harness';

let env: any;
let closeDb: () => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const t = await createTestDb();
  closeDb = t.close;
  env = await makeEnv(t.db);
  stubTelegram();
});
afterEach(() => {
  closeDb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ===== Чистые функции =====

const mem = (o: Partial<MembershipRow> & { id: number }): MembershipRow => ({
  client_name: 'Инна', sessions: 5, price: null, start_date: '2026-10-01', expires_on: null, note: null, ...o,
});
const slot = (id: number, date: string, o: Partial<ApptSlot> = {}): ApptSlot => ({
  id, client_name: 'Инна', date, start_time: '10:00', price: 1000, ...o,
});
const NOW_D = '2026-10-14';
const NOW_T = '12:00';

describe('allocate: списание по факту', () => {
  it('проведённые занятия закрываются самым ранним абонементом, где ещё есть занятия', () => {
    const { covered, views } = allocate(
      [mem({ id: 1, sessions: 2 }), mem({ id: 2, sessions: 3, start_date: '2026-10-05' })],
      [slot(1, '2026-10-02'), slot(2, '2026-10-06'), slot(3, '2026-10-07'), slot(4, '2026-10-08')],
      NOW_D, NOW_T,
    );
    expect([...covered.entries()]).toEqual([[1, 1], [2, 1], [3, 2], [4, 2]]);
    const [a, b] = views;
    expect(a).toMatchObject({ used: 2, remaining: 0, free: 0, state: 'finished' });
    expect(b).toMatchObject({ used: 2, remaining: 1, free: 1, state: 'active' });
  });

  it('запись раньше начала абонемента не списывает его', () => {
    const { covered } = allocate([mem({ id: 1, start_date: '2026-10-10' })], [slot(1, '2026-10-09'), slot(2, '2026-10-10')], NOW_D, NOW_T);
    expect([...covered.keys()]).toEqual([2]);
  });

  it('после срока окончания занятие не списывается; истёкший абонемент с остатком — expired', () => {
    const { covered, views } = allocate(
      [mem({ id: 1, sessions: 5, expires_on: '2026-10-10' })],
      [slot(1, '2026-10-09'), slot(2, '2026-10-12')],
      NOW_D, NOW_T,
    );
    expect([...covered.keys()]).toEqual([1]);
    expect(views[0]).toMatchObject({ used: 1, remaining: 4, state: 'expired' });
  });

  it('будущие записи резервируют занятие, но остаток уменьшают только после проведения', () => {
    const { views } = allocate(
      [mem({ id: 1, sessions: 3 })],
      [slot(1, '2026-10-12'), slot(2, '2026-10-16'), slot(3, '2026-10-17')],
      NOW_D, NOW_T,
    );
    expect(views[0]).toMatchObject({ used: 1, planned: 2, remaining: 2, free: 0, state: 'active' });
  });

  it('сегодняшняя запись: проведена, когда её время начала уже наступило', () => {
    const items = [slot(1, NOW_D, { start_time: '11:00' }), slot(2, NOW_D, { start_time: '15:00' })];
    const { views } = allocate([mem({ id: 1, sessions: 5 })], items, NOW_D, NOW_T);
    expect(views[0]).toMatchObject({ used: 1, planned: 1 });
  });

  it('у разных клиентов абонементы раздельные; клиент без абонемента ничего не списывает', () => {
    const { covered, views } = allocate(
      [mem({ id: 1, client_name: 'Инна' }), mem({ id: 2, client_name: 'Мария' })],
      [slot(1, '2026-10-12', { client_name: 'Инна' }), slot(2, '2026-10-12', { client_name: 'Мария' }), slot(3, '2026-10-12', { client_name: 'Олег' })],
      NOW_D, NOW_T,
    );
    expect([...covered.entries()]).toEqual([[1, 1], [2, 2]]);
    expect(views.map((v) => v.used)).toEqual([1, 1]);
  });

  it('абонемент, который ещё не начался, — upcoming', () => {
    const { views } = allocate([mem({ id: 1, start_date: '2026-10-20' })], [], NOW_D, NOW_T);
    expect(views[0].state).toBe('upcoming');
  });
});

describe('summarize', () => {
  const run = (memberships: MembershipRow[], appts: ApptSlot[]) => summarize(allocate(memberships, appts, NOW_D, NOW_T).views);

  it('абонементов не было', () => {
    expect(run([], [])).toMatchObject({ has_any: false, state: 'none', remaining: 0 });
  });
  it('есть свободные занятия — active; одно свободное — last; свободных нет — exhausted', () => {
    expect(run([mem({ id: 1, sessions: 5 })], [slot(1, '2026-10-12')])).toMatchObject({ state: 'active', remaining: 4, free: 4 });
    expect(run([mem({ id: 1, sessions: 2 })], [slot(1, '2026-10-12')])).toMatchObject({ state: 'last', remaining: 1, free: 1 });
    expect(run([mem({ id: 1, sessions: 2 })], [slot(1, '2026-10-12'), slot(2, '2026-10-13')])).toMatchObject({ state: 'exhausted', remaining: 0, free: 0 });
  });
  it('всё записано вперёд — exhausted, но остаток виден', () => {
    expect(run([mem({ id: 1, sessions: 2 })], [slot(1, '2026-10-16'), slot(2, '2026-10-17')])).toMatchObject({ state: 'exhausted', remaining: 2, planned: 2, free: 0 });
  });
  it('все абонементы истекли — expired', () => {
    expect(run([mem({ id: 1, expires_on: '2026-10-10' })], [])).toMatchObject({ state: 'expired', remaining: 0 });
  });
  it('несколько абонементов суммируются; срок — ближайший, у бессрочного срока нет', () => {
    const two = run([mem({ id: 1, sessions: 3, expires_on: '2026-11-01' }), mem({ id: 2, sessions: 4, expires_on: '2026-12-01' })], []);
    expect(two).toMatchObject({ remaining: 7, free: 7, expires_on: '2026-11-01' });
    expect(run([mem({ id: 1, expires_on: '2026-11-01' }), mem({ id: 2 })], []).expires_on).toBeNull();
  });
});

describe('validateMembership', () => {
  const ok = (b: any) => validateMembership(b, '2026-10-14');
  it('минимум — число занятий; дата начала по умолчанию сегодня', () => {
    expect(ok({ sessions: 10 })).toEqual([{ sessions: 10, price: null, start_date: '2026-10-14', expires_on: null, note: null }, null]);
  });
  it('цена, срок и заметка', () => {
    expect(ok({ sessions: '8', price: '6400', start_date: '2026-10-01', expires_on: '2026-12-01', note: ' на утро ' })).toEqual([
      { sessions: 8, price: 6400, start_date: '2026-10-01', expires_on: '2026-12-01', note: 'на утро' }, null,
    ]);
    expect(ok({ sessions: 1, price: 0 })[0]?.price).toBe(0);
  });
  it('ошибки: занятия, цена, даты', () => {
    for (const bad of [null, {}, { sessions: 0 }, { sessions: 1.5 }, { sessions: 1001 }, { sessions: 'x' },
      { sessions: 5, price: -1 }, { sessions: 5, price: 1.5 }, { sessions: 5, price: 10_000_001 },
      { sessions: 5, start_date: '2026-02-31' }, { sessions: 5, expires_on: 'завтра' },
      { sessions: 5, start_date: '2026-10-10', expires_on: '2026-10-09' }]) {
      expect(ok(bad)[0]).toBeNull();
    }
  });
});

describe('coverageAdjustments / subtractRows', () => {
  it('проведённые записи периода вычитаются из дохода, будущие — из ожидаемого; вне периода игнорируются', () => {
    const covered = [
      slot(1, '2026-10-12', { price: 1000 }), slot(2, '2026-10-12', { price: null }),
      slot(3, '2026-10-16', { price: 800 }), slot(4, '2026-10-30', { price: 700 }),
    ];
    const adj = coverageAdjustments(covered, '2026-10-12', '2026-10-18', NOW_D, NOW_T);
    expect(adj.rows).toEqual([{ date: '2026-10-12', sum: 1000, paid: 1, unpaid: 1 }]);
    expect(adj.expected).toEqual({ sum: 800, count: 1 });
    expect(adj.held).toBe(2);
    expect(subtractRows([{ date: '2026-10-12', sum: 1500, paid: 2, unpaid: 1 }, { date: '2026-10-13', sum: 300, paid: 1, unpaid: 0 }], adj.rows)).toEqual([
      { date: '2026-10-12', sum: 500, paid: 1, unpaid: 0 }, { date: '2026-10-13', sum: 300, paid: 1, unpaid: 0 },
    ]);
  });
});

// ===== API =====

const addAppt = (o: Record<string, unknown> = {}, user = OWNER) =>
  api(env, user, 'POST', '/api/appointments', { date: '2026-10-12', start_time: '10:00', client_name: 'Инна', service: 'personal', ...o });
const sell = (o: Record<string, unknown> = {}, user = OWNER) =>
  api(env, user, 'POST', '/api/memberships', { client_name: 'Инна', sessions: 3, start_date: '2026-10-01', ...o });
const clientId = async (name: string, user = OWNER) =>
  ((await api(env, user, 'GET', '/api/clients')).json as any[]).find((c) => c.name === name).id as number;
const card = async (name: string, user = OWNER) => (await api(env, user, 'GET', `/api/clients/${await clientId(name, user)}`)).json;
const summary = async (name: string, user = OWNER) =>
  (await api(env, user, 'GET', `/api/memberships/summary?name=${encodeURIComponent(name)}`)).json;

describe('API абонементов', () => {
  it('продажа по ID клиента: абонемент виден в карточке с остатком по проведённым занятиям', async () => {
    await addAppt({ date: '2026-10-12' });
    await addAppt({ date: '2026-10-13' });
    const r = await api(env, OWNER, 'POST', '/api/memberships', { client_id: await clientId('Инна'), sessions: 3, price: 2400, start_date: '2026-10-01' });
    expect(r.status).toBe(201);

    const c = await card('Инна');
    expect(c.memberships).toHaveLength(1);
    expect(c.memberships[0]).toMatchObject({ client_name: 'Инна', sessions: 3, price: 2400, used: 2, remaining: 1, free: 1, state: 'active' });
    expect(c.membership_summary).toMatchObject({ has_any: true, state: 'last', remaining: 1 });
  });

  it('продажа по имени заводит клиента, если его ещё нет', async () => {
    expect((await sell({ client_name: 'Новичок' })).status).toBe(201);
    expect(((await api(env, OWNER, 'GET', '/api/clients')).json as any[]).map((c) => c.name)).toContain('Новичок');
  });

  it('списывает только проведённые живые записи: «не пришёл», «отменена» и будущие остаток не уменьшают', async () => {
    await sell({ sessions: 5 });
    await addAppt({ date: '2026-10-12' });
    await addAppt({ date: '2026-10-13', status: 'no_show' });
    await addAppt({ date: '2026-10-13', start_time: '12:00', status: 'cancelled' });
    await addAppt({ date: '2026-10-16' });
    const [m] = (await card('Инна')).memberships;
    expect(m).toMatchObject({ used: 1, planned: 1, remaining: 4, free: 3 });
  });

  it('summary для формы записи: «последнее занятие», «закончился», «не было»', async () => {
    expect(await summary('Инна')).toMatchObject({ has_any: false, state: 'none' });
    await sell({ sessions: 2 });
    await addAppt({ date: '2026-10-12' });
    expect(await summary('Инна')).toMatchObject({ state: 'last', remaining: 1, free: 1 });
    await addAppt({ date: '2026-10-16' }); // последнее занятие уже записано вперёд
    expect(await summary('Инна')).toMatchObject({ state: 'exhausted', remaining: 1, planned: 1, free: 0 });
    expect((await api(env, OWNER, 'GET', '/api/memberships/summary')).status).toBe(400);
  });

  it('изменение и удаление; чужой абонемент недоступен', async () => {
    const id = (await sell({ price: 100 })).json.id;
    expect((await api(env, OWNER, 'PUT', `/api/memberships/${id}`, { sessions: 10, price: 900, start_date: '2026-10-01', expires_on: '2026-12-31', note: 'до НГ' })).status).toBe(200);
    expect((await card('Инна')).memberships[0]).toMatchObject({ sessions: 10, price: 900, expires_on: '2026-12-31', note: 'до НГ' });

    expect((await api(env, OTHER, 'PUT', `/api/memberships/${id}`, { sessions: 1 })).status).toBe(404);
    expect((await api(env, OTHER, 'DELETE', `/api/memberships/${id}`)).json).toEqual({ ok: false });
    expect((await card('Инна')).memberships).toHaveLength(1);

    expect((await api(env, OWNER, 'DELETE', `/api/memberships/${id}`)).json).toEqual({ ok: true });
    expect((await card('Инна')).memberships).toHaveLength(0);
  });

  it('ошибки: нет клиента, неверные данные, чужой client_id', async () => {
    expect((await api(env, OWNER, 'POST', '/api/memberships', { sessions: 3 })).status).toBe(400);
    expect((await sell({ sessions: 0 })).status).toBe(400);
    expect((await sell({ expires_on: '2026-09-01' })).status).toBe(400);
    await addAppt({}, OTHER);
    const foreign = await clientId('Инна', OTHER);
    expect((await api(env, OWNER, 'POST', '/api/memberships', { client_id: foreign, sessions: 3 })).status).toBe(404);
    expect((await api(env, OWNER, 'POST', '/api/memberships', { client_id: 'x', sessions: 3 })).status).toBe(400);
  });

  it('переименование клиента переносит его абонементы', async () => {
    await addAppt();
    await sell();
    await api(env, OWNER, 'PUT', `/api/clients/${await clientId('Инна')}`, { name: 'Инна Петрова' });
    const c = await card('Инна Петрова');
    expect(c.memberships).toHaveLength(1);
    expect(c.memberships[0].used).toBe(1);
    expect((await summary('Инна')).state).toBe('none');
  });
});

describe('абонементы в доходах', () => {
  const week = async () => (await api(env, OWNER, 'GET', '/api/stats?period=week&date=2026-10-14')).json;

  it('продажа — доход дня продажи; занятия по абонементу второй раз не считаются; средний чек без продаж', async () => {
    await addAppt({ date: '2026-10-12', price: 1000 });
    await addAppt({ date: '2026-10-13', price: 1000 });
    await addAppt({ date: '2026-10-12', start_time: '12:00', client_name: 'Мария', price: 500 });
    const before = await week();
    expect(before).toMatchObject({ total: 2500, paid: 3, membership_total: 0, covered: 0 });

    await sell({ sessions: 3, price: 2400, start_date: '2026-10-12' });
    const r = await week();
    expect(r).toMatchObject({ total: 2900, paid: 1, avg: 500, membership_total: 2400, membership_count: 1, covered: 2 });
    expect(r.buckets.find((b: any) => b.key === '2026-10-12')).toMatchObject({ sum: 2900, membership: 2400, membership_count: 1 });
    expect(r.buckets.find((b: any) => b.key === '2026-10-13').sum).toBe(0);
    expect(r.profit).toBe(2900);
  });

  it('занятие сверх абонемента оплачивается отдельно', async () => {
    await sell({ sessions: 1, price: 800, start_date: '2026-10-12' });
    await addAppt({ date: '2026-10-12', price: 1000 });
    await addAppt({ date: '2026-10-13', price: 1000 });
    expect(await week()).toMatchObject({ total: 1800, paid: 1, covered: 1 });
  });

  it('будущие записи по абонементу не входят в ожидаемый доход; продажа в будущем — входит', async () => {
    await sell({ sessions: 3, price: 2400, start_date: '2026-10-12' });
    await addAppt({ date: '2026-10-16', price: 1000 });
    await addAppt({ date: '2026-10-17', client_name: 'Мария', price: 500 });
    expect(await week()).toMatchObject({ expected: 500, expected_count: 1 });

    await sell({ client_name: 'Олег', sessions: 4, price: 3000, start_date: '2026-10-18' });
    const r = await week();
    expect(r).toMatchObject({ expected: 3500, expected_count: 2, membership_total: 2400 });
  });

  it('сравнение с прошлым периодом учитывает продажи и покрытые занятия', async () => {
    await sell({ sessions: 3, price: 2400, start_date: '2026-10-06' });
    await addAppt({ date: '2026-10-07', price: 1000 });
    expect((await week()).prev_total).toBe(2400);
  });

  it('без абонементов отчёт прежний', async () => {
    await addAppt({ date: '2026-10-12', price: 700 });
    expect(await week()).toMatchObject({ total: 700, avg: 700, membership_total: 0, membership_count: 0, covered: 0 });
  });
});

describe('резервная копия', () => {
  it('абонементы выгружаются и восстанавливаются; битые строки пропускаются', async () => {
    await addAppt();
    await sell({ sessions: 4, price: 3000, expires_on: '2026-12-31', note: 'утро' });
    const backup = (await api(env, OWNER, 'GET', '/api/export/json')).json;
    expect(backup.memberships).toHaveLength(1);

    backup.memberships.push({ client_name: 'Битый', sessions: 0, start_date: '2026-10-01' }, { client_name: 'Без даты', sessions: 3 });
    const dry = await api(env, OTHER, 'POST', '/api/import', { backup });
    expect(dry.json.report.memberships).toEqual({ ok: 1, skipped: 2 });

    expect((await api(env, OTHER, 'POST', '/api/import', { backup, confirm: true })).status).toBe(200);
    const restored = await card('Инна', OTHER);
    expect(restored.memberships[0]).toMatchObject({ sessions: 4, price: 3000, expires_on: '2026-12-31', note: 'утро', used: 1 });

    // повторное восстановление заменяет, а не дублирует
    await api(env, OTHER, 'POST', '/api/import', { backup, confirm: true });
    expect((await card('Инна', OTHER)).memberships).toHaveLength(1);
  });

  it('копия без абонементов (старая) восстанавливается', async () => {
    await addAppt();
    const backup = (await api(env, OWNER, 'GET', '/api/export/json')).json;
    delete backup.memberships;
    expect((await api(env, OTHER, 'POST', '/api/import', { backup, confirm: true })).status).toBe(200);
    expect((await card('Инна', OTHER)).memberships).toEqual([]);
  });
});
