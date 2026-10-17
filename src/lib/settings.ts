// Настройки тренера в том виде, в каком их отдаёт API и кладёт резервная копия.
import type { UserRow } from '../types';

export const MAX_CURRENCY_LENGTH = 10;
export const MAX_NAME_LENGTH = 40;
export const MAX_GYM_LENGTH = 60;
export const MAX_GREETING_LENGTH = 500;
export const MAX_BUTTON_LENGTH = 40;

export const DEFAULT_BUTTON_LABEL = '🏋️ Открыть ежедневник';

export type NotifyStyle = 'full' | 'short';

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
  coach_name: string | null;
  gym_name: string | null;
  greeting: string | null;
  button_label: string | null;
  notify_style: NotifyStyle;
}

/** Стиль вечернего расписания: всё, кроме явного «short», считаем подробным. */
export function notifyStyle(v: unknown): NotifyStyle {
  return v === 'short' ? 'short' : 'full';
}

/** Как бот обращается к тренеру: своё имя из настроек, иначе имя из Telegram. */
export function coachName(u: Pick<UserRow, 'coach_name' | 'display_name'>): string {
  return (u.coach_name || u.display_name || '').trim();
}

/** Название зала/студии, если тренер его указал. */
export function gymName(u: Pick<UserRow, 'gym_name'>): string {
  return (u.gym_name || '').trim();
}

/** Подпись кнопки входа в приложение. */
export function buttonLabel(u: Pick<UserRow, 'button_label'>): string {
  return (u.button_label || '').trim() || DEFAULT_BUTTON_LABEL;
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
    coach_name: u.coach_name || null,
    gym_name: u.gym_name || null,
    greeting: u.greeting || null,
    button_label: u.button_label || null,
    notify_style: notifyStyle(u.notify_style),
  };
}

/**
 * Свободный текст из настроек: пустая строка — «по умолчанию» (null), слишком длинный — ошибка (undefined).
 * Пробелы внутри схлопываются, переводы строк в приветствии сохраняются.
 */
export function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  return s.length > max ? undefined : s;
}

/** Подпись валюты из пользовательского ввода: пустая строка — «по умолчанию» (null), слишком длинная — ошибка (undefined). */
export function cleanCurrency(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.length > MAX_CURRENCY_LENGTH ? undefined : s;
}
