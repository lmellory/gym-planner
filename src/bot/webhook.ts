// Обработка апдейтов Telegram (webhook). Команды: /start /menu /today /id; для администратора ещё
// /admin /users /user /stats /health /export /records /backupall /send /broadcast /adduser /ban /unban (см. admin.ts)
import { Hono } from 'hono';
import type { Env, UserRow } from '../types';
import { isAllowedUser } from '../lib/access';
import { ensureUser, getDayNote, listAppointments } from '../db';
import { nowInTz } from '../lib/time';
import { formatDay } from '../lib/format';
import { buttonLabel, coachName, gymName } from '../lib/settings';
import { escapeHtml, openAppKeyboard, sendMessage } from './telegram';
import { handleAdminCommand, isAdmin, isAdminCommand } from './admin';

export const webhook = new Hono<{ Bindings: Env }>();

const WELCOME =
  `🏋️ <b>Ежедневник тренера</b>\n\n` +
  `Удобное расписание тренировок, свободные окна и база клиентов прямо в Telegram.\n\n` +
  `• <b>Записи</b>: персональные, сплиты, группы и повторы по дням недели (кнопка «+»)\n` +
  `• <b>База клиентов</b>: контакты, абонементы, заметки по целям и здоровью\n` +
  `• <b>Финансы</b>: доходы с тренировок и учёт расходов на зал и инвентарь\n` +
  `• <b>Уведомления</b>: вечерний дайджест с расписанием на завтра в чат\n\n` +
  `💬 Быстрые команды: /today — расписание на сегодня, /menu — открыть ежедневник.`;

const ADMIN_NOTE =
  `\n\n🛠 <b>Админ-панель:</b> кнопка 🛠 в шапке приложения. Там можно выбрать тренера и добавлять, менять и удалять его записи. Команды администратора: /admin`;

const ADMIN_WELCOME =
  `🛠 <b>Вы администратор.</b>\n\nОткройте приложение: кнопка 🛠 в шапке открывает админ-панель, где можно выбрать тренера и добавлять, менять и удалять его записи.\n\nКоманды администратора: /admin`;

/**
 * Приветствие с учётом персонализации: обращение по имени, название зала и свой текст.
 * Свой текст экранируется — это пользовательский ввод. Пустое поле означает «как раньше».
 */
export function personalizedWelcome(u: UserRow): string {
  const name = coachName(u);
  const gym = gymName(u);
  const hi = `👋 Привет${name ? `, <b>${escapeHtml(name)}</b>` : ''}!`;
  if (u.greeting && u.greeting.trim()) return `${hi}\n\n${escapeHtml(u.greeting.trim())}`;
  return `${hi}${gym ? `\n🏢 <b>${escapeHtml(gym)}</b>` : ''}\n\n${WELCOME}`;
}

webhook.post('/', async (c) => {
  // Telegram присылает секрет в заголовке (задаётся при setWebhook через secret_token).
  // Если секрет в окружении не задан — не принимаем ничего.
  const secret = c.env.WEBHOOK_SECRET;
  if (!secret || c.req.header('X-Telegram-Bot-Api-Secret-Token') !== secret) return c.text('forbidden', 403);

  // Любая ошибка внутри обработчика не должна превращаться в 500: иначе Telegram будет
  // бесконечно повторять доставку одного и того же апдейта.
  try {
    const update = await c.req.json<any>();
    const msg = update.message;
    if (!msg?.text || !msg.from) return c.text('ok');

    const userId: number = msg.from.id;
    const text: string = msg.text.trim();
    const cmd = text.split(/[\s@]/)[0];
    const appUrl = new URL(c.req.url).origin + '/';

    // /id отвечает всем (нужен, чтобы узнать свой ID). Можно отключить: ENABLE_ID_COMMAND="false"
    if (cmd === '/id' && c.env.ENABLE_ID_COMMAND !== 'false') {
      await sendMessage(c.env, msg.chat.id, `Твой ID: <code>${userId}</code>`);
      return c.text('ok');
    }

    // Команды администратора (ADMIN_ID). Всем остальным бот на них молчит, как и чужим.
    if (isAdminCommand(cmd)) {
      // аргументы — всё после команды (в том числе после суффикса «@бот»)
      if (isAdmin(c.env, userId)) await handleAdminCommand(c.env, msg.chat.id, userId, cmd, text.replace(/^\S+\s*/, ''));
      return c.text('ok');
    }

    // Чужим (и заблокированным) бот молчит. Администратор без доступа тренера получает только вход в приложение.
    const staff = isAdmin(c.env, userId);
    const allowed = await isAllowedUser(c.env, userId);
    if (!allowed && !staff) return c.text('ok');
    if (!allowed) {
      if (cmd === '/start' || cmd === '/menu') {
        await sendMessage(c.env, msg.chat.id, ADMIN_WELCOME, openAppKeyboard(appUrl, '🛠 Открыть приложение'));
      }
      return c.text('ok');
    }

    if (cmd === '/start' || cmd === '/menu') {
      const me = await ensureUser(c.env.DB, userId, c.env.TZ);
      const text = staff ? personalizedWelcome(me) + ADMIN_NOTE : personalizedWelcome(me);
      await sendMessage(c.env, msg.chat.id, text, openAppKeyboard(appUrl, buttonLabel(me)));
    } else if (cmd === '/today') {
      // «Сегодня» считаем в часовом поясе пользователя (как и cron), а не в глобальном TZ
      const u = await ensureUser(c.env.DB, userId, c.env.TZ);
      const { date } = nowInTz(u.tz);
      const items = await listAppointments(c.env.DB, userId, date, date);
      const note = await getDayNote(c.env.DB, userId, date);
      await sendMessage(c.env, msg.chat.id, formatDay(date, items, note), openAppKeyboard(appUrl));
    }
  } catch (e) {
    console.error('webhook error', e);
  }
  return c.text('ok');
});
