import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const coreCode = readFileSync(fileURLToPath(new URL('../webapp/js/core.js', import.meta.url)), 'utf8');

function getContext() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' });
  dom.window.eval(coreCode);
  return dom.window as any;
}

const ctx = getContext();
const computeGaps = ctx.computeGaps;

describe('computeGaps: расчёт свободных окон в расписании', () => {
  it('граница 30 минут: 29 минут игнорируются, 30 минут образуют окно', () => {
    // Разрыв 29 минут: 10:00-11:00 и 11:29-12:29
    const appts29 = [
      { id: 1, start_time: '10:00', end_time: '11:00', status: 'scheduled' },
      { id: 2, start_time: '11:29', end_time: '12:29', status: 'scheduled' },
    ];
    expect(computeGaps(appts29)).toEqual([]);

    // Разрыв 30 минут: 10:00-11:00 и 11:30-12:30
    const appts30 = [
      { id: 1, start_time: '10:00', end_time: '11:00', status: 'scheduled' },
      { id: 2, start_time: '11:30', end_time: '12:30', status: 'scheduled' },
    ];
    const gaps30 = computeGaps(appts30);
    expect(gaps30).toHaveLength(1);
    expect(gaps30[0]).toMatchObject({
      start: '11:00',
      end: '11:30',
      duration: 30,
      afterId: 1,
      beforeId: 2,
    });
  });

  it('окно от начала рабочего дня (work_start) до первой записи', () => {
    const appts = [
      { id: 1, start_time: '11:00', end_time: '12:00', status: 'scheduled' },
    ];
    // Рабочий день с 09:00: окно 09:00 - 11:00 (120 мин)
    const gaps = computeGaps(appts, '09:00', null);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      start: '09:00',
      end: '11:00',
      duration: 120,
      afterId: null,
      beforeId: 1,
    });
  });

  it('окно после последней записи до конца рабочего дня (work_end)', () => {
    const appts = [
      { id: 1, start_time: '11:00', end_time: '12:00', status: 'scheduled' },
    ];
    // Рабочий день до 18:00: окно 12:00 - 18:00 (360 мин)
    const gaps = computeGaps(appts, null, '18:00');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      start: '12:00',
      end: '18:00',
      duration: 360,
      afterId: 1,
      beforeId: null,
    });
  });

  it('полный рабочий день: окна до, между и после записей', () => {
    const appts = [
      { id: 10, start_time: '10:00', end_time: '11:00', status: 'scheduled' },
      { id: 20, start_time: '14:00', end_time: '15:00', status: 'scheduled' },
    ];
    const gaps = computeGaps(appts, '08:00', '20:00');
    expect(gaps).toHaveLength(3);

    // 1. До первой записи
    expect(gaps[0]).toMatchObject({ start: '08:00', end: '10:00', duration: 120, afterId: null, beforeId: 10 });
    // 2. Между записями
    expect(gaps[1]).toMatchObject({ start: '11:00', end: '14:00', duration: 180, afterId: 10, beforeId: 20 });
    // 3. После последней записи
    expect(gaps[2]).toMatchObject({ start: '15:00', end: '20:00', duration: 300, afterId: 20, beforeId: null });
  });

  it('перекрывающиеся и одновременные записи корректно объединяются (без ложных окон)', () => {
    // Две тренировки в одно время (группа/сплит): 10:00-11:00
    // И ещё одна внахлёст: 10:30-11:30
    // Следующая в 12:00-13:00 -> окно должно быть 11:30 - 12:00 (30 мин)
    const appts = [
      { id: 1, start_time: '10:00', end_time: '11:00', status: 'scheduled' },
      { id: 2, start_time: '10:00', end_time: '11:00', status: 'scheduled' },
      { id: 3, start_time: '10:30', end_time: '11:30', status: 'scheduled' },
      { id: 4, start_time: '12:00', end_time: '13:00', status: 'scheduled' },
    ];
    const gaps = computeGaps(appts);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      start: '11:30',
      end: '12:00',
      duration: 30,
      afterId: 3,
      beforeId: 4,
    });
  });

  it('отменённые и неявки игнорируются (не блокируют свободные окна)', () => {
    const appts = [
      { id: 1, start_time: '10:00', end_time: '11:00', status: 'scheduled' },
      { id: 2, start_time: '11:00', end_time: '12:00', status: 'cancelled' },
      { id: 3, start_time: '12:00', end_time: '13:00', status: 'unattended' },
      { id: 4, start_time: '14:00', end_time: '15:00', status: 'scheduled' },
    ];
    const gaps = computeGaps(appts);
    expect(gaps).toHaveLength(1);
    // Так как записи 2 и 3 отменены, окно с 11:00 до 14:00 (180 мин)
    expect(gaps[0]).toMatchObject({
      start: '11:00',
      end: '14:00',
      duration: 180,
      afterId: 1,
      beforeId: 4,
    });
  });

  it('пустой день с заданным графиком возвращает одно окно на весь рабочий день', () => {
    const gaps = computeGaps([], '09:00', '18:00');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      start: '09:00',
      end: '18:00',
      duration: 540,
      afterId: null,
      beforeId: null,
    });
  });
});
