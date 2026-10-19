// Форматирование расписания для сообщений бота (/today, /tomorrow, вечернее уведомление)
import type { Appointment } from '../types';
import { escapeHtml } from '../bot/telegram';
import { weekdayRu } from './time';
import { isActiveStatus } from './status';
import { serviceLabel, SERVICE_LABELS } from './services';

export { serviceLabel, SERVICE_LABELS };

/** Время записи для показа: только начало, например «18:00» (конец нужен лишь для расчётов). */
export function timeLabel(a: Pick<Appointment, 'start_time'> & { end_time?: string | null }): string {
  return a.start_time;
}

export interface ClientContactInfo {
  phone?: string | null;
  telegram?: string | null;
}

export function formatDay(
  date: string,
  items: Appointment[],
  note?: string,
  clientContacts?: Map<string, ClientContactInfo>,
): string {
  items = items.filter((a) => isActiveStatus(a.status)); // отменённые и неявки в расписание не попадают
  const [y, m, d] = date.split('-');
  let out = `<b>📅 ${d}.${m}.${y}, ${weekdayRu(date)}</b>\n`;
  if (!items.length) {
    out += '\nЗаписей нет 💪';
  } else {
    for (const a of items) {
      out += `\n🕐 <b>${timeLabel(a)}</b> · ${escapeHtml(a.client_name)}`;
      if (a.who) out += ` (${escapeHtml(a.who)})`;
      out += ` · 🏋️ ${serviceLabel(a)}`;

      const details: string[] = [];
      if (a.comment) details.push(`💬 ${escapeHtml(a.comment)}`);

      const contact = clientContacts?.get(a.client_name);
      if (contact?.phone) details.push(`📞 ${escapeHtml(contact.phone)}`);
      if (contact?.telegram) {
        const tgClean = contact.telegram.replace(/^@/, '');
        const tgEncoded = encodeURIComponent(tgClean);
        details.push(`💬 <a href="https://t.me/${tgEncoded}">@${escapeHtml(tgClean)}</a>`);
      }

      if (details.length) {
        out += `\n   └ ${details.join(' · ')}`;
      }
      out += '\n';
    }
  }
  if (note && note.trim()) {
    out += `\n📝 <i>${escapeHtml(note.trim())}</i>`;
  }
  return out;
}
