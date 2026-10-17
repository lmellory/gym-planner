// Приём ошибок с клиента Mini App: без авторизации (ошибка может случиться до входа),
// с ограничением размера и простым лимитом на IP. Пишем в console — видно в `wrangler tail`.
import { Hono } from 'hono';
import type { Env } from '../types';

export const clientLog = new Hono<{ Bindings: Env }>();

const MAX_PER_MINUTE = 30;
const WINDOW_MS = 60_000;

/** Счётчики по IP живут в памяти изолята: этого достаточно, чтобы не залить лог спамом. */
const hits = new Map<string, { count: number; since: number }>();

function allowed(ip: string, now: number): boolean {
  const row = hits.get(ip);
  if (!row || now - row.since > WINDOW_MS) {
    hits.set(ip, { count: 1, since: now });
    // изредка подчищаем старые записи, чтобы карта не росла бесконечно
    if (hits.size > 500) {
      for (const [key, value] of hits) if (now - value.since > WINDOW_MS) hits.delete(key);
    }
    return true;
  }
  row.count += 1;
  return row.count <= MAX_PER_MINUTE;
}

/** Обрезаем всё, что пришло: лог не должен раздуваться от гигантского стека или URL. */
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

clientLog.post('/', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  if (!allowed(ip, now)) return c.body(null, 204);

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.body(null, 204);

  const message = text(body.message, 300);
  if (!message) return c.body(null, 204);

  console.log(
    'client-error',
    JSON.stringify({
      kind: text(body.kind, 20),
      message,
      stack: text(body.stack, 800),
      url: text(body.url, 200),
      version: text(body.version, 20),
      ip,
      ua: text(c.req.header('User-Agent'), 160),
    }),
  );

  return c.body(null, 204);
});
