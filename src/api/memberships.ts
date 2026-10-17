// Абонементы клиентов.
//   GET    /api/memberships/summary?name=Имя — остаток по абонементам клиента (для подсказки в форме записи)
//   POST   /api/memberships                  — продать абонемент: { client_id | client_name, sessions, price?, start_date?, expires_on?, note? }
//   PUT    /api/memberships/:id              — изменить (число занятий, цена, даты, заметка)
//   DELETE /api/memberships/:id              — удалить
// Остаток считается на лету (src/lib/memberships.ts): занятие списывается, когда тренировка состоялась.
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import {
  deleteMembership,
  ensureClientExists,
  ensureUser,
  getClient,
  getClientMemberships,
  getMembership,
  insertMembership,
  updateMembership,
} from '../db';
import { nowInTz } from '../lib/time';
import { validateMembership } from '../lib/memberships';

export const memberships = new Hono<{ Bindings: Env; Variables: AppVars }>();

memberships.get('/summary', async (c) => {
  const userId = c.get('userId');
  const name = (c.req.query('name') ?? '').trim();
  if (!name) return c.json({ error: 'Укажите имя клиента' }, 400);
  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const now = nowInTz(u.tz);
  const { summary } = await getClientMemberships(c.env.DB, userId, name, now.date, now.time);
  return c.json(summary);
});

memberships.post('/', async (c) => {
  const userId = c.get('userId');
  const body: any = await c.req.json().catch(() => null);

  let name = String(body?.client_name ?? '').trim().slice(0, 100);
  if (body?.client_id !== undefined && body?.client_id !== null) {
    const clientId = Number(body.client_id);
    if (!Number.isInteger(clientId) || clientId <= 0) return c.json({ error: 'bad client_id' }, 400);
    const client = await getClient(c.env.DB, userId, clientId);
    if (!client) return c.json({ error: 'Клиент не найден' }, 404);
    name = client.name;
  }
  if (!name) return c.json({ error: 'Укажите клиента' }, 400);

  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const [d, err] = validateMembership(body, nowInTz(u.tz).date);
  if (!d) return c.json({ error: err }, 400);

  await ensureClientExists(c.env.DB, userId, name).catch(() => {});
  const id = await insertMembership(c.env.DB, userId, name, d);
  return c.json({ ok: true, id }, 201);
});

memberships.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  if (!(await getMembership(c.env.DB, userId, id))) return c.json({ error: 'not found' }, 404);

  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const [d, err] = validateMembership(await c.req.json().catch(() => null), nowInTz(u.tz).date);
  if (!d) return c.json({ error: err }, 400);
  await updateMembership(c.env.DB, userId, id, d);
  return c.json({ ok: true });
});

memberships.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  return c.json({ ok: await deleteMembership(c.env.DB, c.get('userId'), id) });
});
