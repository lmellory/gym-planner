import { describe, expect, it } from 'vitest';
import { validate } from '../src/api/appointments';

describe('validate appointment input', () => {
  it('успешно валидирует персональную тренировку с авто-расчётом конца (1 ч)', () => {
    const input = {
      date: '2026-10-15',
      start_time: '14:00',
      client_name: 'Мария Иванова',
      service: 'personal',
    };
    const [data, err] = validate(input);
    expect(err).toBeNull();
    expect(data).toBeDefined();
    expect(data?.start_time).toBe('14:00');
    expect(data?.end_time).toBe('15:00'); // +60 мин
    expect(data?.client_name).toBe('Мария Иванова');
    expect(data?.service).toBe('personal');
  });

  it('рассчитывает конец по умолчанию для каждого вида занятия', () => {
    const endOf = (service: string) =>
      validate({ date: '2026-10-15', start_time: '10:00', client_name: 'Ольга', service })[0]?.end_time;
    expect(endOf('personal')).toBe('11:00');
    expect(endOf('split')).toBe('11:00');
    expect(endOf('group')).toBe('11:00');
    expect(endOf('trial')).toBe('10:45');
    expect(endOf('consultation')).toBe('10:30');
    expect(endOf('online')).toBe('11:00');
  });

  it('не хранит и не требует покрытий: лишние поля от старого клиента игнорируются', () => {
    const [data, err] = validate({
      date: '2026-10-15',
      start_time: '10:00',
      client_name: 'Инна',
      service: 'split',
      manicure_coating: 'gel',
      pedicure_coating: 'gel',
    });
    expect(err).toBeNull();
    expect(data).not.toHaveProperty('manicure_coating');
    expect(data).not.toHaveProperty('pedicure_coating');
  });

  it('отклоняет прежние услуги маникюрного бота и неизвестные значения', () => {
    for (const service of ['manicure', 'pedicure', 'both', 'manicure_fingers', 'fingers', 'yoga', '', undefined]) {
      const [d, err] = validate({ date: '2026-10-15', start_time: '10:00', client_name: 'Инна', service });
      expect(d).toBeNull();
      expect(err).toBe('Некорректный вид занятия');
    }
  });

  describe('цена', () => {
    const base = { date: '2026-10-15', start_time: '10:00', client_name: 'Инна', service: 'personal' };

    it('не указана → null', () => {
      expect(validate(base)[0]?.price).toBeNull();
      expect(validate({ ...base, price: '' })[0]?.price).toBeNull();
      expect(validate({ ...base, price: null })[0]?.price).toBeNull();
    });

    it('принимает число, строку и строку с пробелами', () => {
      expect(validate({ ...base, price: 800 })[0]?.price).toBe(800);
      expect(validate({ ...base, price: '1200' })[0]?.price).toBe(1200);
      expect(validate({ ...base, price: '1 500' })[0]?.price).toBe(1500);
      expect(validate({ ...base, price: 0 })[0]?.price).toBe(0);
    });

    it('отклоняет дробные, отрицательные, слишком большие и нечисловые значения', () => {
      for (const price of [12.5, -1, 10_000_001, 'abc', NaN]) {
        const [d, err] = validate({ ...base, price });
        expect(d).toBeNull();
        expect(err).toContain('Цена');
      }
    });
  });

  describe('статус', () => {
    const base = { date: '2026-10-15', start_time: '10:00', client_name: 'Инна', service: 'personal' };

    it('по умолчанию scheduled', () => {
      expect(validate(base)[0]?.status).toBe('scheduled');
      expect(validate({ ...base, status: null })[0]?.status).toBe('scheduled');
    });
    it('принимает no_show и cancelled', () => {
      expect(validate({ ...base, status: 'no_show' })[0]?.status).toBe('no_show');
      expect(validate({ ...base, status: 'cancelled' })[0]?.status).toBe('cancelled');
    });
    it('отклоняет неизвестный статус', () => {
      const [d, err] = validate({ ...base, status: 'done' });
      expect(d).toBeNull();
      expect(err).toContain('статус');
    });
  });

  it('сохраняет переданный явный end_time, если он корректен', () => {
    const input = {
      date: '2026-10-15',
      start_time: '14:00',
      end_time: '15:00',
      client_name: 'Елена',
      service: 'personal',
    };
    const [data, err] = validate(input);
    expect(err).toBeNull();
    expect(data?.end_time).toBe('15:00');
  });

  it('отклоняет некорректную дату и время', () => {
    const [d1, err1] = validate({ date: '2026-02-31', start_time: '10:00', client_name: 'А', service: 'personal' });
    expect(err1).toBe('Некорректная дата');

    const [d2, err2] = validate({ date: '2026-10-15', start_time: '25:00', client_name: 'А', service: 'personal' });
    expect(err2).toBe('Некорректное время');
  });

  it('отклоняет пустое имя клиента', () => {
    const [data, err] = validate({
      date: '2026-10-15',
      start_time: '14:00',
      client_name: '   ',
      service: 'personal',
    });
    expect(err).toBe('Укажи имя клиента');
  });

  it('отклоняет время окончания раньше или равное времени начала', () => {
    const [data, err] = validate({
      date: '2026-10-15',
      start_time: '14:00',
      end_time: '13:30',
      client_name: 'Мария',
      service: 'personal',
    });
    expect(err).toBe('Конец должен быть позже начала');
  });
});

import { cleanBirthday, cleanTelegram } from '../src/api/clients';

describe('cleanBirthday', () => {
  it('нормализует корректные даты DD.MM', () => {
    expect(cleanBirthday('15.03')).toBe('15.03');
    expect(cleanBirthday('9.10')).toBe('09.10');
    expect(cleanBirthday('09-10')).toBe('09.10');
    expect(cleanBirthday(' 01.01 ')).toBe('01.01');
  });

  it('возвращает null для пустых значений', () => {
    expect(cleanBirthday(null)).toBeNull();
    expect(cleanBirthday(undefined)).toBeNull();
    expect(cleanBirthday('')).toBeNull();
    expect(cleanBirthday('   ')).toBeNull();
  });

  it('отклоняет некорректные дни и месяцы', () => {
    expect(cleanBirthday('32.05')).toBeNull();
    expect(cleanBirthday('00.05')).toBeNull();
    expect(cleanBirthday('15.13')).toBeNull();
    expect(cleanBirthday('не_дата')).toBeNull();
    expect(cleanBirthday('15.03.1995')).toBeNull(); // год не допускается
  });
});

describe('cleanTelegram', () => {
  it('нормализует корректные юзернеймы с @ и без него', () => {
    expect(cleanTelegram('@squzzyy23')).toBe('squzzyy23');
    expect(cleanTelegram('squzzyy23')).toBe('squzzyy23');
    expect(cleanTelegram('  @user_123  ')).toBe('user_123');
  });

  it('возвращает null для пустых значений', () => {
    expect(cleanTelegram(null)).toBeNull();
    expect(cleanTelegram(undefined)).toBeNull();
    expect(cleanTelegram('')).toBeNull();
    expect(cleanTelegram('   ')).toBeNull();
  });

  it('отклоняет недопустимые юзернеймы (длина, спецсимволы)', () => {
    expect(cleanTelegram('ab')).toBeNull(); // слишком короткий (< 3)
    expect(cleanTelegram('a'.repeat(33))).toBeNull(); // слишком длинный (> 32)
    expect(cleanTelegram('user-name')).toBeNull(); // дефис запрещён
    expect(cleanTelegram('user.name')).toBeNull(); // точка запрещена
    expect(cleanTelegram('привет')).toBeNull(); // кириллица запрещена
  });
});


