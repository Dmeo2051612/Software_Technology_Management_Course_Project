import { BadRequestException } from '@nestjs/common';

export type VoucherType = 'amount' | 'percent';
/** Phần quy tắc tính giảm — cũng là snapshot lưu trên đơn. */
export interface VoucherRule {
  type: VoucherType;
  value: number;
  maxDiscount: number | null;
}
export interface VoucherSnapshot extends VoucherRule {
  title: string;
}
export interface VoucherFields extends VoucherRule {
  title: string;
  minOrder: number;
  quantity: number;
  usedCount: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
}
export type VoucherState = 'scheduled' | 'running' | 'ended' | 'exhausted' | 'stopped';
export interface VoucherInput {
  title?: string;
  type?: VoucherType;
  value?: number;
  maxDiscount?: number | null;
  minOrder?: number;
  quantity?: number;
  startsAt?: string;
  endsAt?: string;
  active?: boolean;
}

const MAX_DAYS = 180;
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 50_000_000;
const MAX_ORDER = 9_999_999_999;
const MAX_QUANTITY = 100_000;

const money = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)} đ`;
/** dd/mm theo giờ Việt Nam (UTC+7, không đổi giờ). */
const dayMonth = (d: Date) => {
  const vn = new Date(d.getTime() + 7 * 3600000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}`;
};
const bad = (message: string): never => {
  throw new BadRequestException(message);
};
const intIn = (n: unknown, min: number, max: number) =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/** Số tiền giảm cho một tổng tiền hàng; không bao giờ vượt tổng. */
export function voucherDiscount(rule: VoucherRule, subtotal: number): number {
  const raw =
    rule.type === 'amount'
      ? rule.value
      : Math.min(Math.round((subtotal * rule.value) / 100), rule.maxDiscount ?? Infinity);
  return Math.max(0, Math.min(raw, subtotal));
}

export function voucherState(v: VoucherFields, now: Date): VoucherState {
  if (!v.active) return 'stopped';
  if (now >= v.endsAt) return 'ended';
  if (v.usedCount >= v.quantity) return 'exhausted';
  if (now < v.startsAt) return 'scheduled';
  return 'running';
}

/** Lý do nông dân chưa dùng được voucher cho đơn này; null nếu dùng được. */
export function voucherUnusableReason(
  v: VoucherFields,
  ctx: { now: Date; subtotal: number; usedByMe: boolean },
): string | null {
  const state = voucherState(v, ctx.now);
  if (state === 'stopped') return 'Voucher đã dừng.';
  if (state === 'ended') return 'Voucher đã hết hạn.';
  if (ctx.usedByMe) return 'Bạn đã dùng voucher này.';
  if (state === 'exhausted') return 'Voucher đã hết lượt.';
  if (state === 'scheduled') return `Voucher dùng từ ${dayMonth(v.startsAt)}.`;
  if (ctx.subtotal < v.minOrder) return `Đơn tối thiểu ${money(v.minOrder)}.`;
  return null;
}

const LOCKED_WHEN_USED = ['type', 'value', 'maxDiscount', 'minOrder', 'startsAt'] as const;

/**
 * Kiểm tra và chuẩn hoá dữ liệu tạo/sửa voucher. Khi sửa, `existing` là bản
 * hiện tại; các trường không gửi giữ nguyên.
 */
export function validateVoucher(dto: VoucherInput, now: Date, existing?: VoucherFields): VoucherFields {
  const date = (s: string | undefined, fallback: Date | undefined, label: string) => {
    if (s === undefined) return fallback ?? bad(`Thiếu ${label}.`);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? bad(`${label[0].toUpperCase()}${label.slice(1)} không hợp lệ.`) : d;
  };
  const v: VoucherFields = {
    title: (dto.title ?? existing?.title ?? '').trim(),
    type: (dto.type ?? existing?.type) as VoucherType,
    value: dto.value ?? existing?.value ?? NaN,
    maxDiscount: dto.maxDiscount !== undefined ? dto.maxDiscount : (existing?.maxDiscount ?? null),
    minOrder: dto.minOrder ?? existing?.minOrder ?? 0,
    quantity: dto.quantity ?? existing?.quantity ?? NaN,
    usedCount: existing?.usedCount ?? 0,
    startsAt: date(dto.startsAt, existing?.startsAt, 'ngày bắt đầu'),
    endsAt: date(dto.endsAt, existing?.endsAt, 'ngày kết thúc'),
    active: dto.active ?? existing?.active ?? true,
  };

  if (existing && existing.usedCount > 0) {
    const changed = LOCKED_WHEN_USED.some((k) => {
      const a = v[k], b = existing[k];
      return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    });
    if (changed) bad('Voucher đã có người dùng — chỉ sửa được tên, số lượt và ngày kết thúc.');
  }

  if (!v.title || v.title.length > 80) bad('Tên voucher cần từ 1 đến 80 ký tự.');
  if (v.type !== 'amount' && v.type !== 'percent') bad('Loại giảm không hợp lệ.');
  if (v.type === 'amount') {
    v.maxDiscount = null;
    if (!intIn(v.value, MIN_AMOUNT, MAX_AMOUNT))
      bad(`Mức giảm phải từ ${money(MIN_AMOUNT)} đến ${money(MAX_AMOUNT)}.`);
    if (!intIn(v.minOrder, v.value, MAX_ORDER))
      bad(`Đơn tối thiểu phải từ ${money(v.value)} trở lên.`);
  } else {
    if (!intIn(v.value, 1, 90)) bad('Mức giảm % phải từ 1 đến 90.');
    if (!intIn(v.maxDiscount, MIN_AMOUNT, MAX_AMOUNT))
      bad(`Giảm tối đa phải từ ${money(MIN_AMOUNT)} đến ${money(MAX_AMOUNT)}.`);
    if (!intIn(v.minOrder, 0, MAX_ORDER)) bad('Đơn tối thiểu không hợp lệ.');
  }
  if (!intIn(v.quantity, 1, MAX_QUANTITY)) bad(`Số lượt dùng phải từ 1 đến ${MAX_QUANTITY}.`);
  if (v.quantity < v.usedCount) bad(`Số lượt dùng không ít hơn số lượt đã dùng (${v.usedCount}).`);
  if (v.endsAt <= v.startsAt) bad('Ngày kết thúc phải sau ngày bắt đầu.');
  if ((!existing || dto.endsAt !== undefined) && v.endsAt <= now) bad('Ngày kết thúc phải ở tương lai.');
  // +1 ngày: bắt đầu 00:00 và kết thúc 23:59:59 theo ngày chọn nên 180 ngày lịch dài ~181 ngày.
  if (v.endsAt.getTime() - v.startsAt.getTime() > (MAX_DAYS + 1) * 86400000)
    bad(`Voucher chạy tối đa ${MAX_DAYS} ngày.`);
  return v;
}
