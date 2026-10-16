// Настройки тренера в том виде, в каком их отдаёт API и кладёт резервная копия.
import type { UserRow } from '../types';

export const MAX_CURRENCY_LENGTH = 10;

export interface SettingsView {
  notify_enabled: boolean;
  notify_time: string;
  tz: string;
  notify_new_appt: boolean;
  notify_note: boolean;
  notify_summary: boolean;
  work_start_time: string;
  work_end_time: string;
  work_days: string;
  backup_enabled: boolean;
  currency: string | null;
  birthday_time: string;
  backup_time: string;
}

export function settingsView(u: UserRow): SettingsView {
  return {
    notify_enabled: !!u.notify_enabled,
    notify_time: u.notify_time,
    tz: u.tz,
    notify_new_appt: !!u.notify_new_appt,
    notify_note: !!u.notify_note,
    notify_summary: u.notify_summary !== 0,
    work_start_time: u.work_start_time || '09:00',
    work_end_time: u.work_end_time || '20:00',
    work_days: u.work_days || '1,2,3,4,5,6',
    backup_enabled: u.backup_enabled !== 0,
    currency: u.currency || null,
    birthday_time: u.birthday_time || '10:00',
    backup_time: u.backup_time || '21:00',
  };
}

/** Подпись валюты из пользовательского ввода: пустая строка — «по умолчанию» (null), слишком длинная — ошибка (undefined). */
export function cleanCurrency(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.length > MAX_CURRENCY_LENGTH ? undefined : s;
}
