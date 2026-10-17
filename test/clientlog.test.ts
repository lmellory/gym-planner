// Приём ошибок с клиента: без подписи, с обрезкой и лимитом на IP.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { createTestDb, makeEnv } from './helpers/harness';

let env: any;
let closeDb: () => void;

beforeEach(async () => {
  const t = await createTestDb();
  closeDb = t.close;
  env = await makeEnv(t.db);
});

afterEach(() => {
  closeDb();
  vi.restoreAllMocks();
});

const post = (body: unknown, ip: string, raw = false) =>
  worker.fetch(
    new Request('https://app.test/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    env,
    undefined as any,
  );

describe('/api/client-log', () => {
  it('принимает ошибку без подписи Telegram и пишет её в лог', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post({ kind: 'error', message: 'TypeError: x is undefined', stack: 'at app.js:1', url: 'https://app.test/', version: '13' }, '10.0.0.1');
    expect(res.status).toBe(204);
    const record = spy.mock.calls.find((c) => c[0] === 'client-error');
    expect(record).toBeTruthy();
    const payload = JSON.parse(String(record![1]));
    expect(payload).toMatchObject({ kind: 'error', message: 'TypeError: x is undefined', version: '13' });
  });

  it('пустое сообщение и битый JSON молча игнорируются', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await post({ kind: 'error', message: '' }, '10.0.0.2')).status).toBe(204);
    expect((await post({ kind: 'error' }, '10.0.0.3')).status).toBe(204);
    expect((await post('{не json', '10.0.0.4', true)).status).toBe(204);
    expect(spy.mock.calls.filter((c) => c[0] === 'client-error')).toHaveLength(0);
  });

  it('обрезает длинные поля: стек и URL не раздувают лог', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await post({ message: 'я'.repeat(500), stack: 's'.repeat(2000), url: 'u'.repeat(1000) }, '10.0.0.5');
    const record = spy.mock.calls.find((c) => c[0] === 'client-error');
    const payload = JSON.parse(String(record![1]));
    expect(payload.message).toHaveLength(300);
    expect(payload.stack).toHaveLength(800);
    expect(payload.url).toHaveLength(200);
  });

  it('не даёт залить лог спамом: не больше 30 сообщений в минуту с одного IP', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 35; i += 1) {
      expect((await post({ message: `boom ${i}` }, '10.0.0.6')).status).toBe(204);
    }
    expect(spy.mock.calls.filter((c) => c[0] === 'client-error')).toHaveLength(30);
    // другой IP лимит не исчерпал
    const fresh = await post({ message: 'другой клиент' }, '10.0.0.7');
    expect(fresh.status).toBe(204);
    expect(spy.mock.calls.filter((c) => c[0] === 'client-error')).toHaveLength(31);
  });
});
