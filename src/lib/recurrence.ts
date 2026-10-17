// Повторяющиеся записи: «вторник и четверг в 18:00 на 8 недель».
import { addDays } from './time';

export const MAX_REPEAT_WEEKS = 26;
/** Сколько записей можно создать одним запросом (даты серии × участники). */
export const MAX_SERIES_RECORDS = 100;

export interface Repeat {
  weekdays: number[]; // 1 = понедельник … 7 = воскресенье
  weeks: number;      // сколько недель, считая неделю первой записи
}

/** Проверка настроек повтора из тела запроса. Возвращает [повтор, ошибка]. */
export function parseRepeat(raw: unknown): readonly [Repeat, null] | readonly [null, string] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [null, 'Повтор: некорректные настройки'];
  const r = raw as { weekdays?: unknown; weeks?: unknown };
  const weeks = Number(r.weeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_REPEAT_WEEKS) {
    return [null, `Повтор: число недель от 1 до ${MAX_REPEAT_WEEKS}`];
  }
  if (!Array.isArray(r.weekdays)) return [null, 'Повтор: выберите дни недели'];
  const days = new Set<number>();
  for (const x of r.weekdays) {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 1 || n > 7) return [null, 'Повтор: некорректный день недели'];
    days.add(n);
  }
  if (!days.size) return [null, 'Повтор: выберите хотя бы один день недели'];
  return [{ weekdays: [...days].sort((a, b) => a - b), weeks }, null];
}

/**
 * Даты серии по порядку: `weeks` недель (Пн–Вс), начиная с недели startDate; берутся выбранные дни недели,
 * которые не раньше startDate (прошлые дни первой недели пропускаются).
 */
export function expandRepeat(startDate: string, rep: Repeat): string[] {
  const dow = new Date(startDate + 'T00:00:00Z').getUTCDay(); // 0 = воскресенье
  const monday = addDays(startDate, -((dow + 6) % 7));
  const dates: string[] = [];
  for (let w = 0; w < rep.weeks; w++) {
    for (const wd of rep.weekdays) {
      const date = addDays(monday, w * 7 + wd - 1);
      if (date >= startDate) dates.push(date);
    }
  }
  return dates;
}

/** Область удаления записи серии: только эта (по умолчанию), эта и все следующие, вся серия. */
export type DeleteScope = 'this' | 'following' | 'all';
export const isDeleteScope = (s: unknown): s is DeleteScope => s === 'this' || s === 'following' || s === 'all';
