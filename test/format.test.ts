import { describe, expect, it } from 'vitest';
import { timeLabel, formatDay } from '../src/lib/format';
import type { Appointment } from '../src/types';

describe('timeLabel', () => {
  it('возвращает только start_time, если end_time отсутствует', () => {
    expect(timeLabel({ start_time: '18:00', end_time: null })).toBe('18:00');
  });

  it('показывает только время начала, даже если конец сохранён', () => {
    expect(timeLabel({ start_time: '18:00', end_time: '20:00' })).toBe('18:00');
  });
});

describe('formatDay', () => {
  it('форматирует день с записями без end_time', () => {
    const appt: Appointment = {
      id: 1,
      user_id: 123,
      date: '2026-10-10',
      start_time: '14:00',
      end_time: null,
      client_name: 'Анна',
      who: null,
      service: 'personal',
      comment: null,
      price: null,
      status: 'scheduled',
      created_at: '',
      updated_at: '',
    } as Appointment;
    const formatted = formatDay('2026-10-10', [appt]);
    expect(formatted).toContain('🕐 <b>14:00</b> · Анна');
    expect(formatted).toContain('🏋️ персональная тренировка');
  });

  it('подписывает каждый вид занятия', () => {
    const label = (service: string) => {
      const appt: any = {
        id: 3, user_id: 1, date: '2026-10-10', start_time: '15:00', end_time: null,
        client_name: 'Инна', who: null, service, comment: null,
      };
      return formatDay('2026-10-10', [appt]);
    };
    expect(label('split')).toContain('🏋️ сплит-тренировка');
    expect(label('group')).toContain('🏋️ групповое занятие');
    expect(label('trial')).toContain('🏋️ пробное занятие');
    expect(label('consultation')).toContain('🏋️ консультация');
    expect(label('online')).toContain('🏋️ онлайн-тренировка');
  });

  it('пустой день: «Записей нет»', () => {
    expect(formatDay('2026-10-10', [])).toContain('Записей нет 💪');
  });
});
