// Общие типы проекта
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BOT_TOKEN: string;       // secret
  ADMIN_ID?: string;       // Telegram ID администраторов через запятую (wrangler.toml [vars]): команды бота и админ-панель Mini App
  WEBHOOK_SECRET: string;  // secret
  TZ: string;              // wrangler.toml [vars]
  ENABLE_ID_COMMAND?: string;
  APP_URL?: string;        // https-адрес Worker, например https://gym-planner.xxx.workers.dev/
  TURSO_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}

import type { Status } from './lib/status';

export type Service = 'personal' | 'split' | 'group' | 'trial' | 'consultation' | 'online';

export interface Appointment {
  id: number;
  user_id: number;
  date: string;
  start_time: string;
  end_time: string | null; // у новых записей null, у старых может быть значение
  client_name: string;
  who: string | null;     // «кто это, откуда пришёл» (для группы и сплита можно перечислить участников)
  service: Service;
  comment: string | null;
  price: number | null; // цена в валюте тренера, целое число; null — не указана
  status: Status;       // scheduled | no_show | cancelled
  series_id?: string | null; // общий ID серии повторяющихся записей; у одиночных записей null
}

export interface Expense {
  id: number;
  user_id: number;
  date: string;   // YYYY-MM-DD
  name: string;   // на что потрачено
  amount: number; // целое число > 0
}
export type ExpenseInput = Omit<Expense, 'id' | 'user_id'>;

export interface UserRow {
  user_id: number;
  tz: string;
  notify_enabled: number;
  notify_time: string;
  last_notified_date: string | null;
  notify_new_appt: number;
  work_start_time?: string; // '09:00'
  work_end_time?: string;   // '20:00'
  work_days?: string;       // '1,2,3,4,5,6' (1=Пн, 7=Вс)
  last_birthday_notify_date?: string | null;
  backup_enabled?: number;          // 1 — присылать еженедельную копию (по умолчанию)
  last_backup_date?: string | null; // дата воскресного «слота», за который копия отправлена
  notify_note?: number;             // 1 — дублировать заметку дня в чат Telegram (по умолчанию 0)
  currency?: string | null;         // подпись валюты в приложении; null — по умолчанию
  birthday_time?: string;           // '10:00': во сколько присылать поздравление с днём рождения клиента
  backup_time?: string;             // '21:00': во сколько по воскресеньям присылать копию
  notify_summary?: number;          // 1 — присылать воскресную сводку недели (по умолчанию)
  last_summary_date?: string | null; // дата воскресенья, за которое сводка уже отправлена
  coach_name?: string | null;       // как бот обращается к тренеру; NULL — имя из Telegram
  gym_name?: string | null;         // название зала/студии
  greeting?: string | null;         // свой текст приветствия на /start
  button_label?: string | null;     // подпись кнопки входа в приложение
  notify_style?: string;            // 'full' | 'short' — подробность вечернего расписания
  display_name?: string | null;     // имя из Telegram (заполняется при открытии приложения)
}

export interface Client {
  id: number;
  user_id: number;
  name: string;
  phone: string | null;
  telegram: string | null;
  notes: string | null;
  birthday?: string | null; // 'DD.MM' (например '15.03')
  created_at: string;
  updated_at: string;
  appointments_count?: number;
  last_visit?: string | null;
  next_visit?: string | null;
}

export interface FreeSlot {
  start: string;
  end: string;
  duration_minutes: number;
}

// Переменные Hono-контекста (кладём туда проверенный user_id)
// userId — чьи данные обрабатывает запрос (тренер); actorId — кто реально вошёл (при «правке за тренера» они разные)
export type AppVars = { userId: number; actorId: number; isAdmin: boolean };
