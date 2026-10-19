import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import {
  deleteClient,
  ensureUser,
  getClient,
  getClientAppointments,
  getClientMemberships,
  insertClient,
  listClients,
  updateClient,
} from '../db';
import { nowInTz } from '../lib/time';

export const clients = new Hono<{ Bindings: Env; Variables: AppVars }>();

// GET /api/clients?q=...
clients.get('/', async (c) => {
  const userId = c.get('userId');
  const q = c.req.query('q');
  const items = await listClients(c.env.DB, userId, q);
  return c.json(items);
});

// GET /api/clients/:id
clients.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const client = await getClient(c.env.DB, userId, id);
  if (!client) return c.json({ error: 'not found' }, 404);

  const history = await getClientAppointments(c.env.DB, userId, client.name);
  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const now = nowInTz(u.tz);
  const { views, summary } = await getClientMemberships(c.env.DB, userId, client.name, now.date, now.time);
  return c.json({ client, history, memberships: views, membership_summary: summary });
});

export function cleanBirthday(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[.-](\d{1,2})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
}

export function cleanTelegram(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const clean = s.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,32}$/.test(clean)) return null;
  return clean;
}

export function parseClientPayload(body: any): {
  error?: string;
  data?: {
    name: string;
    phone: string | null;
    telegram: string | null;
    notes: string | null;
    birthday: string | null;
  };
} {
  const name = String(body?.name ?? '').trim();
  if (!name) return { error: 'Имя клиента обязательно' };

  let birthday: string | null = null;
  if (body?.birthday !== undefined && body?.birthday !== null && String(body.birthday).trim() !== '') {
    birthday = cleanBirthday(body.birthday);
    if (!birthday) {
      return { error: 'Некорректный день рождения (укажи число и месяц, например 15.03)' };
    }
  }

  let telegram: string | null = null;
  if (body?.telegram !== undefined && body?.telegram !== null && String(body.telegram).trim() !== '') {
    telegram = cleanTelegram(body.telegram);
    if (!telegram) {
      return { error: 'Некорректный username в Telegram (3–32 символа, латиница, цифры и _)' };
    }
  }

  return {
    data: {
      name: name.slice(0, 100),
      phone: body?.phone ? String(body.phone).trim().slice(0, 50) : null,
      telegram,
      notes: body?.notes ? String(body.notes).trim().slice(0, 1000) : null,
      birthday,
    },
  };
}

// POST /api/clients
clients.post('/', async (c) => {
  const userId = c.get('userId');
  const body: any = await c.req.json().catch(() => null);
  const parsed = parseClientPayload(body);
  if (parsed.error || !parsed.data) return c.json({ error: parsed.error }, 400);

  const id = await insertClient(c.env.DB, userId, parsed.data);

  return c.json({ ok: true, id }, 201);
});

// PUT /api/clients/:id
clients.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const body: any = await c.req.json().catch(() => null);
  const parsed = parseClientPayload(body);
  if (parsed.error || !parsed.data) return c.json({ error: parsed.error }, 400);

  const result = await updateClient(c.env.DB, userId, id, parsed.data);

  if (result === 'not_found') return c.json({ error: 'not found' }, 404);
  if (result === 'name_taken') return c.json({ error: 'Клиент с таким именем уже есть' }, 409);
  return c.json({ ok: true });
});

// DELETE /api/clients/:id
clients.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const ok = await deleteClient(c.env.DB, userId, id);
  return c.json({ ok });
});
