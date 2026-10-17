// Доходы и траты: GET /api/stats?period=week|month|year&date=YYYY-MM-DD
// date — любая дата внутри нужного периода (по умолчанию «сегодня» в часовом поясе тренера).
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import {
  ensureUser,
  getExpectedIncome,
  getExpensesByDay,
  getExpensesByName,
  getIncomeByDay,
  getMembershipCoverage,
  getMembershipSalesByDay,
  getStatusCounts,
} from '../db';
import { isDate, nowInTz } from '../lib/time';
import { buildIncomeReport, coverageAdjustments, isPeriod, periodRange, previousRange, subtractRows } from '../lib/stats';

export const stats = new Hono<{ Bindings: Env; Variables: AppVars }>();

stats.get('/', async (c) => {
  const userId = c.get('userId');
  const period = c.req.query('period');
  if (!isPeriod(period)) return c.json({ error: 'period: week | month | year' }, 400);

  const u = await ensureUser(c.env.DB, userId, c.env.TZ);
  const now = nowInTz(u.tz);
  const date = c.req.query('date') ?? now.date;
  if (!isDate(date)) return c.json({ error: 'Некорректная дата' }, 400);

  const { from, to } = periodRange(period, date);
  const prev = previousRange(period, date);
  // В доход идут только состоявшиеся записи (живые, время начала уже прошло); будущие — «ожидается».
  // Записи по абонементу отдельного дохода не дают: деньги уже получены при продаже абонемента (день продажи — start_date).
  const [rows, prevRows, expRows, prevExpRows, expenseItems, expected, counts, coverage, sales, prevSales] = await Promise.all([
    getIncomeByDay(c.env.DB, userId, from, to, now.date, now.time),
    getIncomeByDay(c.env.DB, userId, prev.from, prev.to, now.date, now.time),
    getExpensesByDay(c.env.DB, userId, from, to),
    getExpensesByDay(c.env.DB, userId, prev.from, prev.to),
    getExpensesByName(c.env.DB, userId, from, to),
    getExpectedIncome(c.env.DB, userId, from, to, now.date, now.time),
    getStatusCounts(c.env.DB, userId, from, to),
    getMembershipCoverage(c.env.DB, userId, now.date, now.time),
    getMembershipSalesByDay(c.env.DB, userId, from, to),
    getMembershipSalesByDay(c.env.DB, userId, prev.from, prev.to),
  ]);
  const adj = coverageAdjustments(coverage.covered, from, to, now.date, now.time);
  const prevAdj = coverageAdjustments(coverage.covered, prev.from, prev.to, now.date, now.time);
  // Продажи с датой в будущем — пока только ожидаемый доход
  const received = (list: typeof sales) => list.filter((r) => r.date <= now.date);
  const future = sales.filter((r) => r.date > now.date);
  return c.json(
    buildIncomeReport(period, from, to, subtractRows(rows, adj.rows), subtractRows(prevRows, prevAdj.rows), expRows, prevExpRows, expenseItems, {
      expected: expected.sum - adj.expected.sum + future.reduce((n, r) => n + (Number(r.sum) || 0), 0),
      expected_count: expected.count - adj.expected.count + future.reduce((n, r) => n + (Number(r.count) || 0), 0),
      no_show: counts.no_show ?? 0,
      cancelled: counts.cancelled ?? 0,
      sales: received(sales),
      prev_sales: received(prevSales),
      covered: adj.held,
    }),
  );
});
