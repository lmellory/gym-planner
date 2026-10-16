// Настройки пользователя: GET/PUT /api/settings
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { ensureUser, updateUserSettings } from '../db';
import { isTime } from '../lib/time';
import { cleanCurrency, MAX_CURRENCY_LENGTH, settingsView } from '../lib/settings';

export const settings = new Hono<{ Bindings: Env; Variables: AppVars }>();

settings.get('/', async (c) => {
  const u = await ensureUser(c.env.DB, c.get('userId'), c.env.TZ);
  return c.json(settingsView(u));
});

settings.put('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Некорректное тело запроса' }, 400);
  }

  const {
    notify_enabled,
    notify_time,
    tz,
    notify_new_appt,
    notify_note,
    notify_summary,
    work_start_time,
    work_end_time,
    work_days,
    backup_enabled,
    currency,
    birthday_time,
    backup_time,
  } = body as Record<string, unknown>;

  if (typeof notify_enabled !== 'boolean') {
    return c.json({ error: 'notify_enabled должен быть булевым значением' }, 400);
  }

  for (const [key, value] of Object.entries({ notify_new_appt, notify_note, notify_summary, backup_enabled })) {
    if (value !== undefined && typeof value !== 'boolean') {
      return c.json({ error: `${key} должен быть булевым значением` }, 400);
    }
  }

  if (!isTime(notify_time)) {
    return c.json({ error: 'notify_time должен быть формата HH:MM' }, 400);
  }

  if (work_start_time !== undefined && !isTime(work_start_time)) {
    return c.json({ error: 'work_start_time должен быть формата HH:MM' }, 400);
  }

  if (work_end_time !== undefined && !isTime(work_end_time)) {
    return c.json({ error: 'work_end_time должен быть формата HH:MM' }, 400);
  }

  for (const [key, value] of Object.entries({ birthday_time, backup_time })) {
    if (value !== undefined && !isTime(value)) {
      return c.json({ error: `${key} должен быть формата HH:MM` }, 400);
    }
  }

  let cleanedCurrency: string | null | undefined;
  if (currency !== undefined) {
    cleanedCurrency = cleanCurrency(currency);
    if (cleanedCurrency === undefined) {
      return c.json({ error: `Валюта: не длиннее ${MAX_CURRENCY_LENGTH} символов` }, 400);
    }
  }

  if (typeof tz !== 'string') {
    return c.json({ error: 'Некорректный часовой пояс' }, 400);
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    return c.json({ error: 'Неподдерживаемый часовой пояс' }, 400);
  }

  const userId = c.get('userId');
  const current = await ensureUser(c.env.DB, userId, c.env.TZ);
  const updated = await updateUserSettings(c.env.DB, userId, {
    notify_enabled,
    notify_time,
    tz,
    notify_new_appt: notify_new_appt as boolean | undefined,
    notify_note: notify_note as boolean | undefined,
    notify_summary: notify_summary as boolean | undefined,
    work_start_time: typeof work_start_time === 'string' ? work_start_time : current.work_start_time,
    work_end_time: typeof work_end_time === 'string' ? work_end_time : current.work_end_time,
    work_days: typeof work_days === 'string' ? work_days : current.work_days,
    backup_enabled: backup_enabled as boolean | undefined,
    currency: cleanedCurrency,
    birthday_time: birthday_time as string | undefined,
    backup_time: backup_time as string | undefined,
  });

  return c.json(settingsView(updated));
});
