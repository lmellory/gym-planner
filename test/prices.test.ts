import { describe, expect, it } from 'vitest';
import { parsePricesBody } from '../src/api/prices';

describe('parsePricesBody', () => {
  it('принимает числа, строки и пустые значения', () => {
    expect(parsePricesBody({ personal: 800, split: '1 200', group: null, online: '' })).toEqual({
      ok: true,
      changes: [['personal', 800], ['split', 1200], ['group', null], ['online', null]],
    });
  });

  it('знает все виды занятий', () => {
    expect(parsePricesBody({ trial: '300', consultation: '1 500' })).toEqual({
      ok: true,
      changes: [['trial', 300], ['consultation', 1500]],
    });
  });

  it('не знает прежние виды услуг (маникюр, педикюр)', () => {
    expect(parsePricesBody({ manicure: 800, pedicure: 900 })).toEqual({ ok: true, changes: [] });
  });

  it('неуказанные услуги не трогает, неизвестные игнорирует', () => {
    expect(parsePricesBody({ personal: 500, hairdo: 99999 })).toEqual({ ok: true, changes: [['personal', 500]] });
    expect(parsePricesBody({})).toEqual({ ok: true, changes: [] });
  });

  it('отклоняет дробные, отрицательные, огромные и нечисловые цены', () => {
    for (const v of [12.5, -1, 10_000_001, 'abc']) {
      expect(parsePricesBody({ personal: v })).toMatchObject({ ok: false });
    }
  });

  it('отклоняет тело не-объект', () => {
    expect(parsePricesBody(null)).toMatchObject({ ok: false });
    expect(parsePricesBody('x')).toMatchObject({ ok: false });
  });
});
