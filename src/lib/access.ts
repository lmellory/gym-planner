// Доступ пользователей: администраторы (ADMIN_ID) и таблица access (команды /adduser, /ban, /unban).
//   доступ = выданные через /adduser минус заблокированные через /ban; администраторы проходят всегда.
// Списка ID в секретах больше нет: тренера добавляет администратор командой /adduser.
// Если таблицы access ещё нет (миграция 0013 не применена) или запрос упал, доступ закрыт (fail closed).
// Администраторы при этом работают: они проверяются отдельно, без запросов к базе.
import type { Env } from '../types';

/** Разбор списка Telegram ID через запятую; нечисла и неположительные значения отбрасываются. */
export function parseIdList(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Администраторы: ADMIN_ID — один Telegram ID или несколько через запятую. Пустое или кривое значение = админов нет. */
export function isAdmin(env: Pick<Env, 'ADMIN_ID'>, userId: number): boolean {
  return Number.isInteger(userId) && userId > 0 && parseIdList(env.ADMIN_ID).includes(userId);
}

export interface AccessRow {
  user_id: number;
  added: number;  // 1 — доступ выдан командой /adduser
  banned: number; // 1 — заблокирован командой /ban
}

/** allowed — доступ есть; banned — заблокирован; none — доступа нет (и не блокировали). */
export type AccessState = 'allowed' | 'banned' | 'none';

type AccessEnv = { DB: D1Database };

/** Чистая функция: состояние доступа по строке из таблицы access. */
export function accessState(row: Pick<AccessRow, 'added' | 'banned'> | null): AccessState {
  if (row?.banned) return 'banned';
  return row?.added ? 'allowed' : 'none';
}

const toRow = (x: AccessRow): AccessRow => ({ user_id: Number(x.user_id), added: Number(x.added), banned: Number(x.banned) });

/** Строка access пользователя. Бросает исключение, если запрос не удался (для команд администратора). */
export async function getAccessRow(db: D1Database, userId: number): Promise<AccessRow | null> {
  const r = await db.prepare('SELECT user_id, added, banned FROM access WHERE user_id = ?').bind(userId).first<AccessRow>();
  return r ? toRow(r) : null;
}

/** Все строки access. Бросает исключение, если запрос не удался. */
export async function listAccess(db: D1Database): Promise<AccessRow[]> {
  const r = await db.prepare('SELECT user_id, added, banned FROM access').all<AccessRow>();
  return r.results.map(toRow);
}

/** Как listAccess, но при сбое возвращает пустой список: сломанная таблица не должна ронять cron. */
async function listAccessSafe(db: D1Database): Promise<AccessRow[]> {
  try {
    return await listAccess(db);
  } catch (e) {
    console.error('access: таблица недоступна, доступ закрыт', e);
    return [];
  }
}

export interface AccessSnapshot {
  allowed: number[]; // у кого сейчас есть доступ
  banned: number[];  // кто заблокирован (в том числе тот, кому доступ не выдавали)
}

export async function getAccessSnapshot(env: AccessEnv): Promise<AccessSnapshot> {
  const rows = await listAccessSafe(env.DB);
  const banned = rows.filter((r) => r.banned).map((r) => r.user_id);
  const blocked = new Set(banned);
  const ids = new Set(rows.filter((r) => r.added).map((r) => r.user_id));
  return { allowed: [...ids].filter((id) => !blocked.has(id)), banned };
}

/** ID всех, у кого сейчас есть доступ (для cron-рассылок, /broadcast). */
export async function getAllowedIds(env: AccessEnv): Promise<number[]> {
  return (await getAccessSnapshot(env)).allowed;
}

/** Состояние доступа одного пользователя (при сбое чтения таблицы — доступ закрыт). */
export async function getAccessState(env: AccessEnv, userId: number): Promise<AccessState> {
  let row: AccessRow | null = null;
  try {
    row = await getAccessRow(env.DB, userId);
  } catch (e) {
    console.error('access: таблица недоступна, доступ закрыт', e);
  }
  return accessState(row);
}

/** Есть ли у пользователя доступ (приложение и бот). */
export async function isAllowedUser(env: AccessEnv, userId: number): Promise<boolean> {
  return (await getAccessState(env, userId)) === 'allowed';
}

/** /adduser: выдать доступ. Блокировку не снимает (её снимает /unban). */
export async function grantAccess(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO access (user_id, added) VALUES (?, 1)
       ON CONFLICT(user_id) DO UPDATE SET added = 1, updated_at = datetime('now')`,
    )
    .bind(userId)
    .run();
}

/** /ban и /unban. Строка без выданного доступа и без блокировки удаляется. */
export async function setBanned(db: D1Database, userId: number, banned: boolean): Promise<void> {
  if (banned) {
    await db
      .prepare(
        `INSERT INTO access (user_id, banned) VALUES (?, 1)
         ON CONFLICT(user_id) DO UPDATE SET banned = 1, updated_at = datetime('now')`,
      )
      .bind(userId)
      .run();
    return;
  }
  await db.prepare("UPDATE access SET banned = 0, updated_at = datetime('now') WHERE user_id = ?").bind(userId).run();
  await db.prepare('DELETE FROM access WHERE user_id = ? AND added = 0 AND banned = 0').bind(userId).run();
}
