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
