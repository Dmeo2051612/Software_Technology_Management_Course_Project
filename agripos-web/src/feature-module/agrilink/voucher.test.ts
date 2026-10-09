import { describe, expect, it } from 'vitest';
import type { StorefrontVoucher } from '../../services/agrilink.types';
import {
  bestVoucher,
  orderPayable,
  shortMoney,
  voucherBlocker,
  voucherCondition,
  voucherDiscount,
  voucherStartIso,
  voucherStub,
  vnDayMonth,
} from './voucher';

const now = new Date('2026-10-01T03:00:00Z');
const v = (over: Partial<StorefrontVoucher> = {}): StorefrontVoucher => ({
  id: 'v-1',
  title: 'Giảm 20K đơn từ 500K',
  type: 'amount',
  value: 20000,
  maxDiscount: null,
  minOrder: 500000,
  startsAt: '2026-09-30T00:00:00Z',
  endsAt: '2026-10-31T16:59:59Z',
  remaining: 68,
  saved: true,
  usedByMe: false,
  ...over,
});
const percent = v({ id: 'v-2', title: 'Giảm 5%', type: 'percent', value: 5, maxDiscount: 50000, minOrder: 1000000 });

describe('voucher labels', () => {
  it('shortens money for the ticket stub', () => {
    expect(shortMoney(20000)).toBe('20K');
    expect(shortMoney(1500)).toBe('1,5K');
    expect(shortMoney(1500000)).toBe('1,5TR');
    expect(shortMoney(800)).toBe('800');
  });

  it('builds the stub and the condition line', () => {
    expect(voucherStub(v())).toEqual({ big: '20K', small: 'giảm' });
    expect(voucherStub(percent)).toEqual({ big: '5%', small: 'tối đa 50K' });
    expect(voucherCondition(v())).toBe('Đơn từ 500.000 ₫');
    expect(voucherCondition(v({ minOrder: 0 }))).toBe('Mọi đơn hàng');
  });

  it('formats Vietnam dates and the start of the chosen day', () => {
    expect(vnDayMonth('2026-10-04T17:30:00Z')).toBe('05/10');
    expect(voucherStartIso('2026-10-05')).toBe('2026-10-04T17:00:00.000Z');
  });
});

describe('voucherDiscount', () => {
  it('mirrors the server rule', () => {
    expect(voucherDiscount(v(), 600000)).toBe(20000);
    expect(voucherDiscount(v(), 10000)).toBe(10000);
    expect(voucherDiscount(percent, 1340000)).toBe(50000);
    expect(voucherDiscount(percent, 333330)).toBe(16667);
  });
});

describe('voucherBlocker', () => {
  it('is null when the voucher applies', () => {
    expect(voucherBlocker(v(), 600000, now)).toBeNull();
  });

  it('explains why a voucher cannot be picked', () => {
    expect(voucherBlocker(v({ usedByMe: true }), 600000, now)).toBe('Bạn đã dùng voucher này');
    expect(voucherBlocker(v({ remaining: 0 }), 600000, now)).toBe('Voucher đã hết lượt');
    expect(voucherBlocker(v({ endsAt: '2026-10-01T02:00:00Z' }), 600000, now)).toBe('Voucher đã hết hạn');
    expect(voucherBlocker(v({ startsAt: '2026-10-04T17:00:00Z' }), 600000, now)).toBe('Dùng từ 05/10');
    expect(voucherBlocker(v(), 460000, now)).toBe('Mua thêm 40.000 ₫ để dùng');
  });
});

describe('bestVoucher', () => {
  it('picks the usable voucher with the biggest discount', () => {
    expect(bestVoucher([v(), percent], 1340000, now)?.id).toBe('v-2');
    expect(bestVoucher([v(), percent], 600000, now)?.id).toBe('v-1');
    expect(bestVoucher([v({ usedByMe: true })], 600000, now)).toBeNull();
    expect(bestVoucher(undefined, 600000, now)).toBeNull();
  });
});
describe('orderPayable', () => {
  it('is the final total once completed, otherwise the estimate minus the voucher', () => {
    expect(orderPayable({ estimatedTotal: 1340000, finalTotal: null, discountAmount: 50000 })).toBe(1290000);
    expect(orderPayable({ estimatedTotal: 1340000, finalTotal: 1250000, discountAmount: 50000 })).toBe(1250000);
    expect(orderPayable({ estimatedTotal: 500000, finalTotal: null })).toBe(500000);
  });
});
