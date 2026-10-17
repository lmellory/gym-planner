// Полная резервная копия данных тренера в JSON (для кнопки «Резервная копия» и еженедельной отправки).
import {
  ensureUser,
  getAllAppointments,
  getAllClients,
  getAllDayNotes,
  getAllExpenses,
  getAllMemberships,
  getServicePrices,
} from '../db';
import { settingsView } from './settings';

export const BACKUP_FORMAT = 'gym-planner-backup';
export const BACKUP_VERSION = 2;

export async function buildJsonBackup(db: D1Database, userId: number, fallbackTz: string): Promise<string> {
  const u = await ensureUser(db, userId, fallbackTz);
  const [appointments, clients, expenses, day_notes, prices, memberships] = await Promise.all([
    getAllAppointments(db, userId),
    getAllClients(db, userId),
    getAllExpenses(db, userId),
    getAllDayNotes(db, userId),
    getServicePrices(db, userId),
    getAllMemberships(db, userId),
  ]);
  const settings = settingsView(u);
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      appointments,
      clients,
      memberships,
      expenses,
      prices,
      day_notes,
      settings,
    },
    null,
    2,
  );
}
