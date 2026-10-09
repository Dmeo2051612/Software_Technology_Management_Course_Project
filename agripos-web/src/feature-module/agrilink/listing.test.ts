import { describe, expect, it } from 'vitest';
import { discountPercent, saleEndIso, saleEndLabel, saleEndDateInput } from './listing';

describe('discountPercent', () => {
  it('rounds the saving to a whole percent', () => {
    expect(discountPercent(450000, 420000)).toBe(7);
    expect(discountPercent(200000, 180000)).toBe(10);
  });
  it('returns 0 when there is no real discount', () => {
    expect(discountPercent(0, 0)).toBe(0);
    expect(discountPercent(100, 120)).toBe(0);
  });
});

describe('sale end dates (Vietnam time)', () => {
  it('turns a picked date into the last second of that day in Vietnam', () => {
    expect(saleEndIso('2026-10-06')).toBe('2026-10-06T16:59:59.000Z');
  });
  it('shows the Vietnam calendar date back in the date input and label', () => {
    expect(saleEndDateInput('2026-10-06T16:59:59.000Z')).toBe('2026-10-06');
    expect(saleEndLabel('2026-10-06T16:59:59.000Z')).toBe('KM đến 06/10');
  });
});
