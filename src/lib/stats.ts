// Расчёт периодов и корзин для раздела «Доходы». Чистые функции — без обращения к БД.
import { addDays } from './time';
import { isHeld } from './memberships';
import type { ApptSlot } from './memberships';

export type Period = 'week' | 'month' | 'year';
export const isPeriod = (s: unknown): s is Period => s === 'week' || s === 'month' || s === 'year';

/** Строка из БД: сумма цен и число записей за один день. */
export interface DayRow {
  date: string;
  sum: number;
  paid: number;   // записей с ценой
  unpaid: number; // записей без цены
}

/** Строка из БД: траты за один день. */
export interface ExpenseDayRow {
  date: string;
  sum: number;
  count: number;
}

/** Траты по одной статье (названию) за период. */
export interface ExpenseNameRow {
  name: string;
  sum: number;
  count: number;
}

export interface Bucket {
  key: string;    // YYYY-MM-DD (неделя, месяц) или YYYY-MM (год)
  from: string;
  to: string;
  sum: number;    // доход
  paid: number;
  unpaid: number;
  expense: number; // траты
  expense_count: number;
  membership: number;       // продано абонементов на сумму (входит в sum)
  membership_count: number; // продано абонементов
}

export interface IncomeReport {
  period: Period;
  from: string;
  to: string;
  buckets: Bucket[];
  total: number;
  paid: number;
  unpaid: number;
  avg: number;        // средний чек (по записям с ценой), округлён
  prev_total: number; // доход за предыдущий такой же период
  total_expense: number;
  expense_count: number;
  prev_expense: number;
  profit: number;     // доход минус траты
  expense_items: ExpenseNameRow[]; // траты по статьям, самые большие сверху
  expected: number;       // ожидаемый доход: будущие записи с ценой
  expected_count: number;
  no_show: number;        // записей «не пришёл» в периоде
  cancelled: number;      // записей «отменена» в периоде
  membership_total: number; // продано абонементов на сумму (уже входит в total)
  membership_count: number; // продано абонементов
  covered: number;          // проведено занятий по абонементам (их цена в доход не идёт)
}

export interface IncomeExtras {
  expected: number;
  expected_count: number;
  no_show: number;
  cancelled: number;
  sales: ExpenseDayRow[];      // продажи абонементов по дням (сумма, число)
  prev_sales: ExpenseDayRow[]; // то же за прошлый период
  covered: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12

/** Границы периода, в который попадает дата anchor. Неделя — с понедельника по воскресенье. */
export function periodRange(period: Period, anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split('-').map(Number);
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (period === 'month') {
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
  }
  const weekday = new Date(anchor + 'T00:00:00Z').getUTCDay(); // 0 = воскресенье
  const from = addDays(anchor, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** Предыдущий такой же период (прошлая неделя / месяц / год). */
export function previousRange(period: Period, anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split('-').map(Number);
  if (period === 'year') return periodRange('year', `${y - 1}-01-01`);
  if (period === 'month') {
    return periodRange('month', m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`);
  }
  return periodRange('week', addDays(anchor, -7));
}

/** Раскладывает дни по корзинам: дни для недели и месяца, месяцы для года. */
export function buildBuckets(
  period: Period,
  from: string,
  to: string,
  rows: DayRow[],
  expenseRows: ExpenseDayRow[] = [],
  salesRows: ExpenseDayRow[] = [],
): Bucket[] {
  const buckets: Bucket[] = [];
  if (period === 'year') {
    const y = Number(from.slice(0, 4));
    for (let m = 1; m <= 12; m++) {
      buckets.push({
        key: `${y}-${pad(m)}`,
        from: `${y}-${pad(m)}-01`,
        to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`,
        sum: 0, paid: 0, unpaid: 0, expense: 0, expense_count: 0, membership: 0, membership_count: 0,
      });
    }
  } else {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      buckets.push({ key: d, from: d, to: d, sum: 0, paid: 0, unpaid: 0, expense: 0, expense_count: 0, membership: 0, membership_count: 0 });
    }
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const r of rows) {
    const b = byKey.get(period === 'year' ? r.date.slice(0, 7) : r.date);
    if (!b) continue; // строка вне периода — игнорируем
    b.sum += Number(r.sum) || 0;
    b.paid += Number(r.paid) || 0;
    b.unpaid += Number(r.unpaid) || 0;
  }
  for (const r of expenseRows) {
    const b = byKey.get(period === 'year' ? r.date.slice(0, 7) : r.date);
    if (!b) continue;
    b.expense += Number(r.sum) || 0;
    b.expense_count += Number(r.count) || 0;
  }
  for (const r of salesRows) {
    const b = byKey.get(period === 'year' ? r.date.slice(0, 7) : r.date);
    if (!b) continue;
    const sum = Number(r.sum) || 0;
    b.sum += sum; // продажа абонемента — доход дня продажи
    b.membership += sum;
    b.membership_count += Number(r.count) || 0;
  }
  return buckets;
}

/**
 * Записи, покрытые абонементами, не приносят отдельного дохода: деньги уже получены при продаже.
 * Возвращает поправки: по дням для проведённых записей периода (вычитаются из доходов), сумму ожидаемых
 * (будущих) записей периода и число проведённых.
 */
export function coverageAdjustments(
  covered: ApptSlot[],
  from: string,
  to: string,
  nowDate: string,
  nowTime: string,
): { rows: DayRow[]; expected: { sum: number; count: number }; held: number } {
  const byDate = new Map<string, DayRow>();
  const expected = { sum: 0, count: 0 };
  let held = 0;
  for (const a of covered) {
    if (a.date < from || a.date > to) continue;
    if (isHeld(a, nowDate, nowTime)) {
      held++;
      const row = byDate.get(a.date) ?? { date: a.date, sum: 0, paid: 0, unpaid: 0 };
      row.sum += a.price ?? 0;
      if (a.price === null) row.unpaid++;
      else row.paid++;
      byDate.set(a.date, row);
    } else if (a.price !== null) {
      expected.sum += a.price;
      expected.count++;
    }
  }
  return { rows: [...byDate.values()], expected, held };
}

/** Вычитает поправки по дням из строк доходов. */
export function subtractRows(rows: DayRow[], adjustments: DayRow[]): DayRow[] {
  const adj = new Map(adjustments.map((r) => [r.date, r]));
  return rows.map((r) => {
    const a = adj.get(r.date);
    if (!a) return r;
    return {
      date: r.date,
      sum: (Number(r.sum) || 0) - a.sum,
      paid: (Number(r.paid) || 0) - a.paid,
      unpaid: (Number(r.unpaid) || 0) - a.unpaid,
    };
  });
}

export function buildIncomeReport(
  period: Period,
  from: string,
  to: string,
  rows: DayRow[],
  prevRows: DayRow[],
  expenseRows: ExpenseDayRow[] = [],
  prevExpenseRows: ExpenseDayRow[] = [],
  expenseItems: ExpenseNameRow[] = [],
  extras: Partial<IncomeExtras> = {},
): IncomeReport {
  const buckets = buildBuckets(period, from, to, rows, expenseRows, extras.sales ?? []);
  const total = buckets.reduce((s, b) => s + b.sum, 0);
  const membership_total = buckets.reduce((s, b) => s + b.membership, 0);
  const membership_count = buckets.reduce((s, b) => s + b.membership_count, 0);
  const paid = buckets.reduce((s, b) => s + b.paid, 0);
  const unpaid = buckets.reduce((s, b) => s + b.unpaid, 0);
  const prev_total =
    prevRows.reduce((s, r) => s + (Number(r.sum) || 0), 0) +
    (extras.prev_sales ?? []).reduce((s, r) => s + (Number(r.sum) || 0), 0);
  const total_expense = buckets.reduce((s, b) => s + b.expense, 0);
  const expense_count = buckets.reduce((s, b) => s + b.expense_count, 0);
  const prev_expense = prevExpenseRows.reduce((s, r) => s + (Number(r.sum) || 0), 0);
  return {
    period, from, to, buckets, total, paid, unpaid,
    avg: paid ? Math.round((total - membership_total) / paid) : 0, // средний чек — только по занятиям, без продаж абонементов
    prev_total,
    total_expense, expense_count, prev_expense,
    profit: total - total_expense,
    expense_items: expenseItems.map((m) => ({ name: m.name, sum: Number(m.sum) || 0, count: Number(m.count) || 0 })),
    expected: extras.expected ?? 0,
    expected_count: extras.expected_count ?? 0,
    no_show: extras.no_show ?? 0,
    cancelled: extras.cancelled ?? 0,
    membership_total,
    membership_count,
    covered: extras.covered ?? 0,
  };
}
