// Персонализация: обращение по имени, свой текст приветствия, название зала, короткое расписание.
import { describe, expect, it } from 'vitest';
import { personalizedWelcome } from '../src/bot/webhook';
import { shortDay } from '../src/cron';
import {
  buttonLabel,
  cleanText,
  coachName,
  DEFAULT_BUTTON_LABEL,
  gymName,
  notifyStyle,
} from '../src/lib/settings';

const user = (patch: Record<string, unknown> = {}) =>
  ({ user_id: 111, tz: 'UTC', notify_time: '22:00', notify_enabled: 1, notify_new_appt: 1, ...patch }) as any;

describe('coachName и gymName', () => {
  it('своё имя важнее имени из Telegram', () => {
    expect(coachName(user({ coach_name: 'Саша', display_name: 'Alexandr' }))).toBe('Саша');
  });

  it('без своего имени берётся имя из Telegram', () => {
    expect(coachName(user({ display_name: 'Alexandr' }))).toBe('Alexandr');
  });

  it('пусто везде — пустая строка (бот поздоровается без имени)', () => {
    expect(coachName(user())).toBe('');
  });

  it('пробелы по краям обрезаются у названия зала', () => {
    expect(gymName(user({ gym_name: '  Зал «Атлет» ' }))).toBe('Зал «Атлет»');
  });
});

describe('cleanText', () => {
  it('обрезает пробелы и сохраняет переводы строк', () => {
    expect(cleanText('  строка\nвторая  ', 100)).toBe('строка\nвторая');
  });

  it('пустая строка и null означают «по умолчанию»', () => {
    expect(cleanText('', 10)).toBeNull();
    expect(cleanText('   ', 10)).toBeNull();
    expect(cleanText(null, 10)).toBeNull();
  });

  it('слишком длинный текст и не строка — ошибка', () => {
    expect(cleanText('я'.repeat(11), 10)).toBeUndefined();
    expect(cleanText(42, 10)).toBeUndefined();
  });
});

describe('buttonLabel и notifyStyle', () => {
  it('без своей подписи — стандартная кнопка', () => {
    expect(buttonLabel(user())).toBe(DEFAULT_BUTTON_LABEL);
    expect(buttonLabel(user({ button_label: 'Открыть зал' }))).toBe('Открыть зал');
  });

  it('стиль расписания: всё, кроме явного short, — полный', () => {
    expect(notifyStyle(undefined)).toBe('full');
    expect(notifyStyle('что-то')).toBe('full');
    expect(notifyStyle('short')).toBe('short');
  });
});

describe('personalizedWelcome', () => {
  it('здоровается по имени и показывает зал', () => {
    const text = personalizedWelcome(user({ coach_name: 'Саша', gym_name: 'Зал «Атлет»' }));
    expect(text).toContain('Привет, <b>Саша</b>!');
    expect(text).toContain('Зал «Атлет»');
    expect(text).toContain('Ежедневник тренера'); // стандартный текст остался ниже
  });

  it('без имени — просто «Привет!»', () => {
    expect(personalizedWelcome(user())).toContain('👋 Привет!');
  });

  it('свой текст заменяет стандартную инструкцию', () => {
    const text = personalizedWelcome(user({ coach_name: 'Саша', greeting: 'Пиши мне в любое время' }));
    expect(text).toBe('👋 Привет, <b>Саша</b>!\n\nПиши мне в любое время');
    expect(text).not.toContain('База клиентов');
  });

  it('свой текст экранируется: HTML не пролезает', () => {
    const text = personalizedWelcome(user({ greeting: '<script>alert(1)</script>' }));
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });
});

describe('shortDay', () => {
  const appt = (patch: Record<string, unknown>) =>
    ({ start_time: '10:00', client_name: 'Инна', status: 'scheduled', ...patch }) as any;

  it('только время и имя, без контактов и цены', () => {
    expect(shortDay([appt({}), appt({ start_time: '12:00', client_name: 'Мария', price: 800 })])).toBe(
      '• <b>10:00</b> — Инна\n• <b>12:00</b> — Мария',
    );
  });

  it('отменённые и «не пришёл» не попадают', () => {
    expect(shortDay([appt({ status: 'cancelled' }), appt({ status: 'no_show' })])).toBe('<i>Занятий нет</i>');
  });

  it('имя клиента экранируется', () => {
    expect(shortDay([appt({ client_name: '<b>Инна</b>' })])).toContain('&lt;b&gt;Инна&lt;/b&gt;');
  });
});
