import { describe, expect, it } from 'vitest';
import type { ManagedVoucher } from '../../../services/agrilink.types';
import { initialVoucherForm, vnToday, voucherFormInput, voucherPatch } from './voucherForm';

const used: ManagedVoucher = {
  id: 'v-1',
  title: 'Giảm 5%',
  type: 'percent',
  value: 5,
  maxDiscount: 50000,
  minOrder: 300000,
  quantity: 50,
  usedCount: 3,
  savedCount: 10,
  // Tạo qua API/smoke: giờ lẻ, không phải 00:00.
  startsAt: '2026-09-29T07:31:12.000Z',
  endsAt: '2026-10-15T16:59:59.000Z',
  active: true,
  state: 'running',
  hasOrders: true,
};

describe('voucher form', () => {
  it('uses the Vietnam date for today even late in the UTC day', () => {
    expect(vnToday(new Date('2026-09-29T18:30:00Z'))).toBe('2026-09-30');
    expect(initialVoucherForm(null, '2026-09-30')).toMatchObject({ start: '2026-09-30', end: '2026-10-30', quantity: '100' });
  });

  it('turns the form into API input with Vietnam day bounds', () => {
    expect(
      voucherFormInput({ ...initialVoucherForm(null, '2026-10-01'), title: ' Giảm 20K ', value: '20.000', minOrder: '500.000' }),
    ).toEqual({
      title: 'Giảm 20K',
      type: 'amount',
      value: 20000,
      maxDiscount: null,
      minOrder: 500000,
      quantity: 100,
      startsAt: '2026-09-30T17:00:00.000Z',
      endsAt: '2026-10-31T16:59:59.000Z',
    });
  });

  it('sends only the fields the dealer changed, never an untouched start date', () => {
    const form = initialVoucherForm(used);
    expect(voucherPatch(used, form)).toEqual({});
    expect(voucherPatch(used, { ...form, quantity: '80', end: '2026-10-20' })).toEqual({
      quantity: 80,
      endsAt: '2026-10-20T16:59:59.000Z',
    });
  });
});
