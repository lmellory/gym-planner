// CRUD записей + проверка пересечений (предупреждение, без запрета).
import { Hono } from 'hono';
import type { AppVars, Env, Service } from '../types';
import {
  NEW_APPT_MSG_TTL_SEC,
  deleteAppointment,
  deleteAppointmentScope,
  ensureClientExists,
  ensureUser,
  findConflicts,
  getAppointment,
  insertAppointment,
  listAppointments,
  scheduleMessageDelete,
  updateAppointment,
} from '../db';
import { addMinutes, defaultServiceDuration, isDate, isTime } from '../lib/time';
import { escapeHtml, sendMessage } from '../bot/telegram';
import { parseAmount } from '../lib/money';
import { SERVICES } from '../lib/services';
import { isStatus } from '../lib/status';
import { serviceLabel, timeLabel } from '../lib/format';
import { MAX_SERIES_RECORDS, expandRepeat, isDeleteScope, parseRepeat } from '../lib/recurrence';

export const appointments = new Hono<{ Bindings: Env; Variables: AppVars }>();

/** Проверка и нормализация тела запроса. Возвращает [данные, ошибка]. */
export function validate(b: any) {
  if (!isDate(b?.date)) return [null, 'Некорректная дата'] as const;
  if (!isTime(b?.start_time)) return [null, 'Некорректное время'] as const;
  const name = String(b?.client_name ?? '').trim();
  if (!name) return [null, 'Укажи имя клиента'] as const;
  if (!SERVICES.includes(b?.service)) return [null, 'Некорректный вид занятия'] as const;

  let endTime = isTime(b?.end_time) ? (b.end_time as string) : null;
  if (!endTime) {
    endTime = addMinutes(b.start_time, defaultServiceDuration(b.service));
  }
  if (endTime <= b.start_time) return [null, 'Конец должен быть позже начала'] as const;

  const price = parseAmount(b?.price);
  if (price === undefined) return [null, 'Цена: целое число от 0 до 10 000 000'] as const;

  const status = b?.status === undefined || b?.status === null ? 'scheduled' : b.status;
  if (!isStatus(status)) return [null, 'Некорректный статус'] as const;

  return [{
    date: b.date as string,
    start_time: b.start_time as string,
    end_time: endTime,
    client_name: name.slice(0, 100),
    who: b.who ? String(b.who).slice(0, 200) : null,
    service: b.service as Service,
    comment: b.comment ? String(b.comment).slice(0, 1000) : null,
    price,
    status,
  }, null] as const;
}

// GET /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
appointments.get('/', async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to required' }, 400);
  return c.json(await listAppointments(c.env.DB, c.get('userId'), from, to));
});

// POST /api/appointments/check — проверка пересечений до сохранения (для предупреждения в форме).
appointments.post('/check', async (c) => {
  const b: any = await c.req.json().catch(() => null);
  if (!isDate(b?.date) || !isTime(b?.start_time)) return c.json({ conflicts: [] });
  const service = SERVICES.includes(b?.service) ? b.service : 'personal';
  const endTime = isTime(b?.end_time)
    ? (b.end_time as string)
    : addMinutes(b.start_time, defaultServiceDuration(service));
  const conflicts = await findConflicts(
    c.env.DB, c.get('userId'), b.date, b.start_time, endTime, Number(b.exclude_id) || 0,
  );
  return c.json({ conflicts });
});

/** Сколько дополнительных участников можно записать за раз (кроме основного клиента). */
export const MAX_PARTICIPANTS = 20;

/**
 * Дополнительные участники сплита / группы: имена без пустых, лишних пробелов и повторов
 * (без учёта регистра, в том числе повторов основного клиента). Возвращает [имена, ошибка].
 */
export function cleanParticipants(raw: unknown, mainName: string, service: Service): readonly [string[], null] | readonly [null, string] {
  if (raw === undefined || raw === null) return [[], null];
  if (!Array.isArray(raw)) return [null, 'Участники: ожидается список имён'];
  const seen = new Set([mainName.toLowerCase()]);
  const names: string[] = [];
  for (const item of raw) {
    const name = String(item ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  if (names.length && service !== 'split' && service !== 'group') {
    return [null, 'Несколько участников можно указать только для сплита и группового занятия'];
  }
  if (names.length > MAX_PARTICIPANTS) return [null, `Не больше ${MAX_PARTICIPANTS} дополнительных участников`];
  return [names, null];
}

// POST /api/appointments — создать (пересечение не блокирует, возвращаем conflicts).
// Для сплита и группы можно передать participants: ['Иван', 'Мария'] — каждому участнику создаётся своя запись
// на то же время (с тем же видом занятия, ценой, статусом и комментарием).
// Повтор: repeat: { weekdays: [2, 4], weeks: 8 } (1 = Пн … 7 = Вс) — записи на выбранные дни недели в течение
// `weeks` недель, начиная с недели d.date (дни раньше d.date пропускаются). У каждого клиента своя серия (series_id).
appointments.post('/', async (c) => {
  const userId = c.get('userId');
  const body: any = await c.req.json().catch(() => null);
  const [d, err] = validate(body);
  if (!d) return c.json({ error: err }, 400);
  const [extra, extraErr] = cleanParticipants(body?.participants, d.client_name, d.service);
  if (!extra) return c.json({ error: extraErr }, 400);

  let dates = [d.date];
  if (body?.repeat !== undefined && body.repeat !== null) {
    const [rep, repErr] = parseRepeat(body.repeat);
    if (!rep) return c.json({ error: repErr }, 400);
    dates = expandRepeat(d.date, rep);
    if (!dates.length) return c.json({ error: 'В выбранный период нет подходящих дней' }, 400);
  }
  const names = [d.client_name, ...extra];
  if (dates.length * names.length > MAX_SERIES_RECORDS) {
    return c.json({ error: `Слишком много записей за раз (максимум ${MAX_SERIES_RECORDS}): уменьшите число недель, дней или участников` }, 400);
  }
  const repeating = dates.length > 1;

  const ids: number[] = [];
  for (const name of names) {
    const seriesId = repeating ? crypto.randomUUID() : null;
    for (const date of dates) {
      ids.push(await insertAppointment(c.env.DB, userId, { ...d, date, client_name: name, series_id: seriesId }));
    }
    await ensureClientExists(c.env.DB, userId, name, d.who).catch(() => {});
  }
  const id = ids[0];
  // Пересечения показываем по первой дате; записи этой же группы и серии друг другу не «конфликтуют»
  const conflicts = (
    await findConflicts(c.env.DB, userId, dates[0], d.start_time, d.end_time ?? addMinutes(d.start_time, 60), id)
  ).filter((x) => !ids.includes(x.id));

  // Уведомление тренера в Telegram о новой записи: только когда её добавил не он сам (администратор от его имени)
  // и если это включено в настройках. О своих записях тренер и так знает, лишние сообщения ему не нужны.
  // Отправляем в фоне: не задерживает ответ, ошибки не ломают сохранение.
  // Сообщение бот сам удалит из чата через NEW_APPT_MSG_TTL_SEC (запись в базе остаётся).
  const notify = (async () => {
    // ensureUser вызываем всегда: он заводит строку пользователя (её читают /users, /backupall, воскресные копии)
    const u = await ensureUser(c.env.DB, userId, c.env.TZ);
    if (c.get('actorId') === userId) return;
    if (!u.notify_new_appt) return;
    const dayLabel = (iso: string) => iso.split('-').reverse().join('.');
    const text =
      `🏋️ <b>Новая запись: ${dayLabel(dates[0])}</b>\n` +
      `🕐 <b>${timeLabel(d)}</b> · ${names.map((n) => escapeHtml(n)).join(', ')}${d.who ? ` (${escapeHtml(d.who)})` : ''}\n` +
      `🏋️ ${serviceLabel(d)}` +
      (repeating ? `\n🔁 Повторяется: ${dates.length} занятий, последнее ${dayLabel(dates[dates.length - 1])}` : '') +
      (d.comment ? `\n💬 ${escapeHtml(d.comment)}` : '');
    const r = await sendMessage(c.env, userId, text);
    const messageId = r.result?.message_id;
    if (r.ok && typeof messageId === 'number') {
      await scheduleMessageDelete(c.env.DB, userId, messageId, NEW_APPT_MSG_TTL_SEC);
    }
  })().catch((e) => console.error('new-appointment notify error', e));
  try {
    c.executionCtx.waitUntil(notify);
  } catch {
    await notify; // окружение без executionCtx (например, тесты)
  }

  return c.json({ id, ids, conflicts, series: repeating }, 201);
});

// PUT /api/appointments/:id — изменить / перенести (меняется date и/или время)
appointments.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  if (!(await getAppointment(c.env.DB, userId, id))) return c.json({ error: 'not found' }, 404);
  const [d, err] = validate(await c.req.json().catch(() => null));
  if (!d) return c.json({ error: err }, 400);
  await updateAppointment(c.env.DB, userId, id, d);
  await ensureClientExists(c.env.DB, userId, d.client_name, d.who).catch(() => {});
  const conflicts = await findConflicts(
    c.env.DB,
    userId,
    d.date,
    d.start_time,
    d.end_time ?? addMinutes(d.start_time, 60),
    id,
  );
  return c.json({ ok: true, conflicts });
});

// DELETE /api/appointments/:id
appointments.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);
  // ?scope=following — эту и все следующие записи серии, ?scope=all — всю серию; по умолчанию только эту
  const scope = c.req.query('scope') ?? 'this';
  if (!isDeleteScope(scope)) return c.json({ error: 'bad scope' }, 400);
  if (scope !== 'this') {
    const deleted = await deleteAppointmentScope(c.env.DB, c.get('userId'), id, scope);
    return c.json({ ok: deleted > 0, deleted });
  }
  return c.json({ ok: await deleteAppointment(c.env.DB, c.get('userId'), id) });
});
