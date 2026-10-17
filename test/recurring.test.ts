// Этап 3: повторяющиеся записи («вторник и четверг на N недель») и удаление серии.
// В тестах «сегодня» = среда 2026-10-14.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REPEAT_WEEKS, MAX_SERIES_RECORDS, expandRepeat, isDeleteScope, parseRepeat } from '../src/lib/recurrence';
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

const appt = (o: Record<string, unknown> = {}) => ({ date: '2026-10-14', start_time: '18:00', client_name: 'Инна', service: 'personal', ...o });
const add = (o: Record<string, unknown> = {}, user = OWNER) => api(env, user, 'POST', '/api/appointments', appt(o));
const list = async (user = OWNER) =>
  (await api(env, user, 'GET', '/api/appointments?from=2026-10-01&to=2027-06-30')).json as any[];
const datesOf = (rows: any[], name: string) => rows.filter((a) => a.client_name === name).map((a) => a.date);
const TUE_THU = { weekdays: [2, 4], weeks: 2 };

describe('expandRepeat / parseRepeat', () => {
  it('начало в среду: прошедший вторник первой недели пропускается', () => {
    expect(expandRepeat('2026-10-14', { weekdays: [2, 4], weeks: 2 })).toEqual(['2026-10-15', '2026-10-20', '2026-10-22']);
  });
  it('начало во вторник: сам день входит', () => {
    expect(expandRepeat('2026-10-13', { weekdays: [2, 4], weeks: 3 })).toEqual([
      '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29',
    ]);
  });
  it('воскресенье — седьмой день недели; переход через конец месяца и года', () => {
    expect(expandRepeat('2026-10-18', { weekdays: [7], weeks: 2 })).toEqual(['2026-10-18', '2026-10-25']);
    expect(expandRepeat('2026-12-28', { weekdays: [1], weeks: 2 })).toEqual(['2026-12-28', '2027-01-04']);
  });
  it('все выбранные дни раньше начала и одна неделя — пусто', () => {
    expect(expandRepeat('2026-10-18', { weekdays: [1, 2], weeks: 1 })).toEqual([]);
  });

  it('parseRepeat: дни сортируются и не повторяются; кривые настройки отклоняются', () => {
    expect(parseRepeat({ weekdays: [4, 2, 4], weeks: '3' })).toEqual([{ weekdays: [2, 4], weeks: 3 }, null]);
    for (const bad of [null, 'вт', [], {}, { weekdays: [2] }, { weekdays: [], weeks: 2 }, { weekdays: [0], weeks: 2 }, { weekdays: [8], weeks: 2 },
      { weekdays: ['x'], weeks: 2 }, { weekdays: [2], weeks: 0 }, { weekdays: [2], weeks: 1.5 }, { weekdays: [2], weeks: MAX_REPEAT_WEEKS + 1 }]) {
      expect(parseRepeat(bad)[0]).toBeNull();
    }
  });

  it('isDeleteScope', () => {
    expect(['this', 'following', 'all'].every(isDeleteScope)).toBe(true);
    expect(isDeleteScope('series')).toBe(false);
  });
});

describe('создание серии', () => {
  it('записи на каждую дату с одним series_id; время, вид и цена те же', async () => {
    const r = await add({ price: 800, repeat: TUE_THU });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ series: true });
    expect(r.json.ids).toHaveLength(3);

    const rows = await list();
    expect(rows.map((a) => a.date)).toEqual(['2026-10-15', '2026-10-20', '2026-10-22']);
    expect(new Set(rows.map((a) => a.series_id)).size).toBe(1);
    expect(rows[0].series_id).toBeTruthy();
    for (const a of rows) expect(a).toMatchObject({ start_time: '18:00', service: 'personal', price: 800, client_name: 'Инна' });
  });

  it('без repeat запись одиночная: series_id пустой', async () => {
    const r = await add();
    expect(r.json.series).toBe(false);
    expect((await list())[0].series_id).toBeNull();
  });

  it('повтор, дающий одну дату, серию не создаёт', async () => {
    const r = await add({ repeat: { weekdays: [3], weeks: 1 } }); // только сама среда
    expect(r.status).toBe(201);
    expect(r.json.series).toBe(false);
    expect((await list())[0].series_id).toBeNull();
  });

  it('сплит с участниками и повтором: у каждого своя серия на все даты', async () => {
    const r = await add({ service: 'split', participants: ['Олег'], repeat: TUE_THU });
    expect(r.status).toBe(201);
    expect(r.json.ids).toHaveLength(6);
    const rows = await list();
    expect(datesOf(rows, 'Инна')).toEqual(datesOf(rows, 'Олег'));
    const seriesOf = (n: string) => new Set(rows.filter((a) => a.client_name === n).map((a) => a.series_id));
    expect(seriesOf('Инна').size).toBe(1);
    expect(seriesOf('Олег').size).toBe(1);
    expect([...seriesOf('Инна')][0]).not.toBe([...seriesOf('Олег')][0]);
  });

  it('пересечения считаются по первой дате и без записей самой серии', async () => {
    await add({ client_name: 'Борис', date: '2026-10-15', start_time: '18:30' });
    const r = await add({ repeat: TUE_THU });
    expect(r.json.conflicts.map((c: any) => c.client_name)).toEqual(['Борис']);
  });

  it('ошибки: кривой повтор, нет подходящих дней, слишком много записей — 400, ничего не создаётся', async () => {
    expect((await add({ repeat: { weekdays: [2], weeks: 99 } })).status).toBe(400);
    expect((await add({ repeat: { weekdays: [], weeks: 2 } })).status).toBe(400);
    expect((await add({ date: '2026-10-18', repeat: { weekdays: [1, 2], weeks: 1 } })).json.error).toContain('нет подходящих дней');
    const tooMany = await add({ repeat: { weekdays: [1, 2, 3, 4, 5, 6, 7], weeks: MAX_REPEAT_WEEKS } });
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.error).toContain(String(MAX_SERIES_RECORDS));
    const groupTooMany = await add({ service: 'group', participants: Array.from({ length: 10 }, (_, i) => `К${i}`), repeat: { weekdays: [2, 4], weeks: 6 } });
    expect(groupTooMany.status).toBe(400); // 11 дат × 11 клиентов
    expect(await list()).toHaveLength(0);
  });
});

describe('удаление серии', () => {
  const makeSeries = async () => {
    await add({ date: '2026-10-12', repeat: { weekdays: [2, 4], weeks: 3 } }); // 13, 15, 20, 22, 27, 29 октября
    return list();
  };

  it('по умолчанию удаляется только одна запись, ответ как раньше', async () => {
    const rows = await makeSeries();
    expect(rows).toHaveLength(6);
    expect((await api(env, OWNER, 'DELETE', `/api/appointments/${rows[2].id}`)).json).toEqual({ ok: true });
    expect((await list()).map((a) => a.date)).toEqual(['2026-10-13', '2026-10-15', '2026-10-22', '2026-10-27', '2026-10-29']);
  });

  it('following: эта и все следующие; прошлые остаются', async () => {
    const rows = await makeSeries();
    const r = await api(env, OWNER, 'DELETE', `/api/appointments/${rows[2].id}?scope=following`);
    expect(r.json).toEqual({ ok: true, deleted: 4 });
    expect((await list()).map((a) => a.date)).toEqual(['2026-10-13', '2026-10-15']);
  });

  it('all: вся серия, в том числе прошедшие записи', async () => {
    const rows = await makeSeries();
    const r = await api(env, OWNER, 'DELETE', `/api/appointments/${rows[3].id}?scope=all`);
    expect(r.json).toEqual({ ok: true, deleted: 6 });
    expect(await list()).toHaveLength(0);
  });

  it('удаление серии одного участника не трогает остальных, одиночные записи и других тренеров', async () => {
    await add({ service: 'group', participants: ['Олег'], repeat: TUE_THU });
    const single = (await add({ client_name: 'Борис', date: '2026-10-16', start_time: '09:00' })).json.id;
    await add({ repeat: TUE_THU }, OTHER);
    const inna = (await list()).find((a) => a.client_name === 'Инна');
    await api(env, OWNER, 'DELETE', `/api/appointments/${inna.id}?scope=all`);

    const rows = await list();
    expect(rows.filter((a) => a.client_name === 'Олег')).toHaveLength(3);
    expect(rows.some((a) => a.client_name === 'Инна')).toBe(false);
    expect(rows.find((a) => a.id === single)).toBeTruthy();
    expect(await list(OTHER)).toHaveLength(3);
  });

  it('чужую запись по ID не удалить; у одиночной записи scope=all удаляет только её', async () => {
    await add({ repeat: TUE_THU }, OTHER);
    const foreign = (await list(OTHER))[0];
    expect((await api(env, OWNER, 'DELETE', `/api/appointments/${foreign.id}?scope=all`)).json).toEqual({ ok: false, deleted: 0 });
    expect(await list(OTHER)).toHaveLength(3);

    const a = (await add({ client_name: 'Борис', start_time: '09:00' })).json.id;
    const b = (await add({ client_name: 'Мария', start_time: '10:00' })).json.id;
    expect((await api(env, OWNER, 'DELETE', `/api/appointments/${a}?scope=all`)).json).toEqual({ ok: true, deleted: 1 });
    expect((await list()).map((x) => x.id)).toEqual([b]);
  });

  it('неизвестная область — 400, ничего не удаляется', async () => {
    const rows = await makeSeries();
    expect((await api(env, OWNER, 'DELETE', `/api/appointments/${rows[0].id}?scope=series`)).status).toBe(400);
    expect(await list()).toHaveLength(6);
  });
});

describe('резервная копия', () => {
  it('серия сохраняется при выгрузке и восстановлении', async () => {
    await add({ repeat: TUE_THU });
    const backup = (await api(env, OWNER, 'GET', '/api/export/json')).json;
    expect(backup.appointments.every((a: any) => a.series_id)).toBe(true);

    expect((await api(env, OTHER, 'POST', '/api/import', { backup, confirm: true })).status).toBe(200);
    const restored = await list(OTHER);
    expect(restored.map((a) => a.date)).toEqual(['2026-10-15', '2026-10-20', '2026-10-22']);
    expect(new Set(restored.map((a) => a.series_id)).size).toBe(1);

    // и серия работает: удаляется целиком
    await api(env, OTHER, 'DELETE', `/api/appointments/${restored[1].id}?scope=all`);
    expect(await list(OTHER)).toHaveLength(0);
  });
});
