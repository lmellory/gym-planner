// Допустимые виды занятий. Проверяются в коде (в БД на service нет CHECK),
// поэтому новый вид занятия добавляется здесь, в src/lib/time.ts (длительность), src/lib/format.ts и
// api/export.ts (подписи), в webapp (кнопки формы и прайс) — миграция не нужна.
//  personal     — персональная тренировка
//  split        — сплит-тренировка (2–3 человека)
//  group        — групповое занятие
//  trial        — пробное занятие
//  consultation — консультация / замеры / составление программы
//  online       — онлайн-тренировка
export const SERVICES: readonly string[] = ['personal', 'split', 'group', 'trial', 'consultation', 'online'];

export const SERVICE_LABELS: Record<string, string> = {
  personal: 'персональная тренировка',
  split: 'сплит-тренировка',
  group: 'групповое занятие',
  trial: 'пробное занятие',
  consultation: 'консультация',
  online: 'онлайн-тренировка',
};

/** Получить русское название услуги. Принимает строку вида 'personal' или объект { service: 'personal' }. */
export function serviceLabel(a: { service: string } | string): string {
  const key = typeof a === 'string' ? a : a.service;
  return SERVICE_LABELS[key] ?? key;
}
