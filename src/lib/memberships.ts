// Абонементы: остаток занятий и распределение записей по абонементам. Чистые функции — без обращения к БД.
//
// Правило списания (по факту): проведённая тренировка клиента уменьшает остаток. «Проведённая» — как в доходах:
// живая запись (status = scheduled), время начала которой уже наступило. Каждая запись клиента закрывается
// самым ранним подходящим абонементом: дата записи не раньше start_date и не позже expires_on, и в нём ещё есть занятия.
// Будущие записи распределяются так же (прогноз), но остаток уменьшают только после того, как состоялись.
import { isDate } from './time';

export const MAX_MEMBERSHIP_SESSIONS = 1000;

export interface MembershipRow {
  id: number;
  client_name: string;
  sessions: number;
  price: number | null;
  start_date: string;
  expires_on: string | null;
  note: string | null;
}

/** Живая запись клиента (status = scheduled). */
export interface ApptSlot {
  id: number;
  client_name: string;
  date: string;
  start_time: string;
  price: number | null;
}

export type MembershipState = 'active' | 'finished' | 'expired' | 'upcoming';

export interface MembershipView extends MembershipRow {
  used: number;      // проведено занятий по этому абонементу
  planned: number;   // уже записано вперёд (ещё не проведено)
  remaining: number; // осталось занятий (sessions − used)
  free: number;      // осталось и ещё не записано (remaining − planned)
  state: MembershipState; // active — действует и есть занятия; finished — занятия кончились; expired — срок истёк; upcoming — ещё не началась
}

export interface Allocation {
  /** id записи → id абонемента, который её покрывает. */
  covered: Map<number, number>;
  views: MembershipView[];
}

/** Проведена ли запись к моменту now: её начало уже наступило. */
export const isHeld = (a: { date: string; start_time: string }, nowDate: string, nowTime: string): boolean =>
  a.date < nowDate || (a.date === nowDate && a.start_time <= nowTime);

/** Действует ли абонемент в этот день (срок не вышел и он уже начался). */
const coversDate = (m: MembershipRow, date: string): boolean =>
  m.start_date <= date && (m.expires_on === null || date <= m.expires_on);

/**
 * Раскладывает записи по абонементам (у каждого клиента отдельно) и считает остатки.
 * Записи и абонементы можно передавать в любом порядке и для любых клиентов.
 */
export function allocate(memberships: MembershipRow[], appts: ApptSlot[], nowDate: string, nowTime: string): Allocation {
  const covered = new Map<number, number>();
  const used = new Map<number, number>();
  const planned = new Map<number, number>();

  const byClient = new Map<string, MembershipRow[]>();
  for (const m of memberships) {
    if (!byClient.has(m.client_name)) byClient.set(m.client_name, []);
    byClient.get(m.client_name)!.push(m);
  }
  for (const list of byClient.values()) list.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id);

  const ordered = [...appts].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time) || a.id - b.id,
  );
  const taken = new Map<number, number>(); // id абонемента → сколько занятий уже закреплено (проведённых и будущих)
  for (const a of ordered) {
    const options = byClient.get(a.client_name);
    if (!options) continue;
    const m = options.find((x) => coversDate(x, a.date) && (taken.get(x.id) ?? 0) < x.sessions);
    if (!m) continue;
    taken.set(m.id, (taken.get(m.id) ?? 0) + 1);
    covered.set(a.id, m.id);
    const bucket = isHeld(a, nowDate, nowTime) ? used : planned;
    bucket.set(m.id, (bucket.get(m.id) ?? 0) + 1);
  }

  const views = memberships.map((m): MembershipView => {
    const u = used.get(m.id) ?? 0;
    const p = planned.get(m.id) ?? 0;
    const remaining = m.sessions - u;
    const state: MembershipState =
      remaining <= 0 ? 'finished'
      : m.expires_on !== null && m.expires_on < nowDate ? 'expired'
      : m.start_date > nowDate ? 'upcoming'
      : 'active';
    return { ...m, used: u, planned: p, remaining, free: Math.max(0, remaining - p), state };
  });
  return { covered, views };
}

/** Итог по клиенту: сколько занятий ещё можно провести по действующим абонементам. */
export interface ClientMembershipSummary {
  has_any: boolean;       // у клиента когда-либо был абонемент
  remaining: number;      // осталось по действующим абонементам (с учётом ещё не начавшихся)
  planned: number;        // из них уже записано вперёд
  free: number;           // осталось и не записано
  expires_on: string | null; // ближайший срок окончания среди действующих
  state: 'none' | 'active' | 'last' | 'exhausted' | 'expired';
  // none — абонементов не было; active — есть свободные занятия; last — свободное занятие последнее;
  // exhausted — занятия закончились (или все распределены по записям); expired — все абонементы истекли
}

export function summarize(views: MembershipView[]): ClientMembershipSummary {
  if (!views.length) return { has_any: false, remaining: 0, planned: 0, free: 0, expires_on: null, state: 'none' };
  const live = views.filter((v) => v.state === 'active' || v.state === 'upcoming');
  const remaining = live.reduce((s, v) => s + v.remaining, 0);
  const planned = live.reduce((s, v) => s + v.planned, 0);
  const free = live.reduce((s, v) => s + v.free, 0);
  const expiries = live.map((v) => v.expires_on).filter((x): x is string => x !== null).sort();
  const hasUnlimited = live.some((v) => v.expires_on === null);
  const allExpired = !live.length && views.some((v) => v.state === 'expired');
  const state: ClientMembershipSummary['state'] = live.length
    ? free > 1 ? 'active' : free === 1 ? 'last' : 'exhausted'
    : allExpired ? 'expired' : 'exhausted';
  return {
    has_any: true, remaining, planned, free,
    expires_on: hasUnlimited ? null : (expiries[0] ?? null),
    state,
  };
}

/** Проверка тела запроса абонемента. Возвращает [данные, ошибка]. */
export function validateMembership(
  b: any,
  today: string,
): readonly [{ sessions: number; price: number | null; start_date: string; expires_on: string | null; note: string | null }, null] | readonly [null, string] {
  const sessions = Number(b?.sessions);
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > MAX_MEMBERSHIP_SESSIONS) {
    return [null, `Число занятий: от 1 до ${MAX_MEMBERSHIP_SESSIONS}`];
  }
  let price: number | null = null;
  if (b?.price !== undefined && b?.price !== null && b?.price !== '') {
    price = Number(b.price);
    if (!Number.isInteger(price) || price < 0 || price > 10_000_000) return [null, 'Цена: целое число от 0 до 10 000 000'];
  }
  const start = b?.start_date === undefined || b?.start_date === null || b?.start_date === '' ? today : b.start_date;
  if (!isDate(start)) return [null, 'Некорректная дата начала'];
  let expires: string | null = null;
  if (b?.expires_on !== undefined && b?.expires_on !== null && b?.expires_on !== '') {
    if (!isDate(b.expires_on)) return [null, 'Некорректная дата окончания'];
    if (b.expires_on < start) return [null, 'Срок действия не может закончиться раньше начала'];
    expires = b.expires_on;
  }
  const note = b?.note ? String(b.note).trim().slice(0, 500) || null : null;
  return [{ sessions, price, start_date: start, expires_on: expires, note }, null];
}
