import { BadRequestException } from '@nestjs/common';
import {
  validateVoucher,
  voucherDiscount,
  voucherState,
  voucherUnusableReason,
  type VoucherFields,
} from './voucher-rules';

const now = new Date('2026-10-01T03:00:00Z');
const day = 86400000;
const at = (d: number) => new Date(now.getTime() + d * day);

const running: VoucherFields = {
  title: 'Giảm 20K đơn từ 500K',
  type: 'amount',
  value: 20000,
  maxDiscount: null,
  minOrder: 500000,
  quantity: 100,
  usedCount: 3,
  startsAt: at(-1),
  endsAt: at(10),
  active: true,
};

describe('voucherDiscount', () => {
  it('takes a fixed amount but never more than the subtotal', () => {
    expect(voucherDiscount({ type: 'amount', value: 20000, maxDiscount: null }, 600000)).toBe(20000);
    expect(voucherDiscount({ type: 'amount', value: 20000, maxDiscount: null }, 15000)).toBe(15000);
  });

  it('takes a rounded percentage capped by the max discount', () => {
    expect(voucherDiscount({ type: 'percent', value: 5, maxDiscount: 50000 }, 1340000)).toBe(50000);
    expect(voucherDiscount({ type: 'percent', value: 5, maxDiscount: 50000 }, 333330)).toBe(16667);
  });

  it('gives nothing on an empty order', () => {
    expect(voucherDiscount({ type: 'percent', value: 5, maxDiscount: 50000 }, 0)).toBe(0);
  });
});

describe('voucherState', () => {
  it.each([
    [{}, 'running'],
    [{ active: false }, 'stopped'],
    [{ endsAt: at(-0.5) }, 'ended'],
    [{ usedCount: 100 }, 'exhausted'],
    [{ startsAt: at(2) }, 'scheduled'],
    [{ active: false, endsAt: at(-1) }, 'stopped'],
    [{ usedCount: 100, endsAt: at(-1) }, 'ended'],
  ])('%j → %s', (patch, state) => {
    expect(voucherState({ ...running, ...patch }, now)).toBe(state);
  });
});

describe('voucherUnusableReason', () => {
  const ctx = { now, subtotal: 600000, usedByMe: false };

  it('is null for a running voucher over the minimum', () => {
    expect(voucherUnusableReason(running, ctx)).toBeNull();
  });

  it('explains every blocker in farmer-facing words', () => {
    expect(voucherUnusableReason({ ...running, active: false }, ctx)).toBe('Voucher đã dừng.');
    expect(voucherUnusableReason({ ...running, endsAt: at(-1) }, ctx)).toBe('Voucher đã hết hạn.');
    expect(voucherUnusableReason(running, { ...ctx, usedByMe: true })).toBe('Bạn đã dùng voucher này.');
    expect(voucherUnusableReason({ ...running, usedCount: 100 }, ctx)).toBe('Voucher đã hết lượt.');
    expect(voucherUnusableReason({ ...running, startsAt: new Date('2026-10-05T01:00:00Z') }, ctx)).toBe(
      'Voucher dùng từ 05/10.',
    );
    expect(voucherUnusableReason(running, { ...ctx, subtotal: 499999 })).toBe('Đơn tối thiểu 500.000 đ.');
  });
});

describe('validateVoucher', () => {
  const create = {
    title: '  Mùa bón thúc — giảm 5% ',
    type: 'percent' as const,
    value: 5,
    maxDiscount: 50000,
    minOrder: 1000000,
    quantity: 50,
    startsAt: at(0).toISOString(),
    endsAt: at(14).toISOString(),
  };
  const bad = (fn: () => unknown, message: string) => {
    expect(fn).toThrow(BadRequestException);
    expect(fn).toThrow(message);
  };

  it('normalizes a new percent voucher', () => {
    expect(validateVoucher(create, now)).toEqual({
      title: 'Mùa bón thúc — giảm 5%',
      type: 'percent',
      value: 5,
      maxDiscount: 50000,
      minOrder: 1000000,
      quantity: 50,
      usedCount: 0,
      startsAt: at(0),
      endsAt: at(14),
      active: true,
    });
  });

  it('drops the max discount of an amount voucher and defaults the minimum to 0 only when valid', () => {
    const v = validateVoucher({ ...create, type: 'amount', value: 20000, maxDiscount: 99999, minOrder: 20000 }, now);
    expect(v.maxDiscount).toBeNull();
    bad(() => validateVoucher({ ...create, type: 'amount', value: 20000, minOrder: undefined }, now), 'Đơn tối thiểu phải từ');
  });

  it('rejects missing or out-of-range fields', () => {
    bad(() => validateVoucher({ ...create, title: '  ' }, now), 'Tên voucher');
    bad(() => validateVoucher({ ...create, title: 'x'.repeat(81) }, now), 'Tên voucher');
    bad(() => validateVoucher({ ...create, type: undefined }, now), 'Loại giảm');
    bad(() => validateVoucher({ ...create, value: 91 }, now), 'Mức giảm % phải từ 1 đến 90');
    bad(() => validateVoucher({ ...create, value: 2.5 }, now), 'Mức giảm % phải từ 1 đến 90');
    bad(() => validateVoucher({ ...create, maxDiscount: null }, now), 'Giảm tối đa');
    bad(() => validateVoucher({ ...create, type: 'amount', value: 500, minOrder: 1000 }, now), 'Mức giảm phải từ 1.000 đ');
    bad(() => validateVoucher({ ...create, quantity: 0 }, now), 'Số lượt dùng');
    bad(() => validateVoucher({ ...create, endsAt: at(0).toISOString() }, now), 'Ngày kết thúc phải sau ngày bắt đầu');
    bad(() => validateVoucher({ ...create, startsAt: at(-10).toISOString(), endsAt: at(-1).toISOString() }, now), 'Ngày kết thúc phải ở tương lai');
    bad(() => validateVoucher({ ...create, endsAt: at(181.5).toISOString() }, now), 'tối đa 180 ngày');
    // Chọn ngày D → D+180 (00:00 → 23:59:59) vẫn hợp lệ.
    expect(() => validateVoucher({ ...create, endsAt: at(180.99).toISOString() }, now)).not.toThrow();
  });

  it('only lets a used voucher change its title, quantity, end date and active flag', () => {
    const used = { ...running, usedCount: 12 };
    expect(validateVoucher({ title: 'Mới', quantity: 20, endsAt: at(20).toISOString(), active: false }, now, used)).toMatchObject({
      title: 'Mới',
      quantity: 20,
      endsAt: at(20),
      active: false,
      value: 20000,
    });
    // Gửi lại đúng giá trị cũ thì không tính là sửa.
    expect(() => validateVoucher({ value: 20000, minOrder: 500000 }, now, used)).not.toThrow();
    bad(() => validateVoucher({ value: 30000 }, now, used), 'Voucher đã có người dùng');
    bad(() => validateVoucher({ startsAt: at(-2).toISOString() }, now, used), 'Voucher đã có người dùng');
    bad(() => validateVoucher({ quantity: 11 }, now, used), 'không ít hơn số lượt đã dùng (12)');
  });

  it('lets a stopped or ended voucher be saved without moving its end date', () => {
    const ended = { ...running, startsAt: at(-30), endsAt: at(-1) };
    expect(() => validateVoucher({ title: 'Đổi tên' }, now, ended)).not.toThrow();
    bad(() => validateVoucher({ endsAt: at(-0.5).toISOString() }, now, ended), 'Ngày kết thúc phải ở tương lai');
  });
});
