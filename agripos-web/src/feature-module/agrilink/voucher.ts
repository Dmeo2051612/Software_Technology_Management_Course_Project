/** Tiện ích hiển thị và tính voucher của đại lý (máy chủ vẫn tính lại khi đặt đơn). */
import type { StorefrontVoucher, VoucherRule, VoucherState } from '../../services/agrilink.types';
import { fmtVND } from '../../utils/formatters';

const VN_OFFSET_MS = 7 * 3600 * 1000;
const frac = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n);

/** 20000 → "20K", 1500000 → "1,5TR" — cho phần cuống thẻ voucher. */
export function shortMoney(n: number): string {
  if (n >= 1e6) return `${frac(n / 1e6)}TR`;
  if (n >= 1e3) return `${frac(n / 1e3)}K`;
  return String(n);
}

export function voucherStub(v: VoucherRule): { big: string; small: string } {
  if (v.type === 'percent')
    return { big: `${v.value}%`, small: v.maxDiscount ? `tối đa ${shortMoney(v.maxDiscount)}` : 'giảm' };
  return { big: shortMoney(v.value), small: 'giảm' };
}

export function voucherCondition(v: VoucherRule): string {
  return v.minOrder > 0 ? `Đơn từ ${fmtVND(v.minOrder)}` : 'Mọi đơn hàng';
}

/** Cùng công thức với máy chủ: không bao giờ vượt tổng tiền hàng. */
export function voucherDiscount(v: VoucherRule, subtotal: number): number {
  const raw =
    v.type === 'amount'
      ? v.value
      : Math.min(Math.round((subtotal * v.value) / 100), v.maxDiscount ?? Infinity);
  return Math.max(0, Math.min(raw, subtotal));
}

/** ISO → "dd/mm" theo giờ Việt Nam. */
export function vnDayMonth(iso: string): string {
  const d = new Date(new Date(iso).getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

/** Ngày chọn (YYYY-MM-DD) → 00:00 ngày đó theo giờ Việt Nam, dạng ISO. */
export function voucherStartIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - VN_OFFSET_MS).toISOString();
}

/** Lý do chưa chọn được voucher cho đơn này; null nếu dùng được. */
export function voucherBlocker(v: StorefrontVoucher, subtotal: number, now = new Date()): string | null {
  if (new Date(v.endsAt) <= now) return 'Voucher đã hết hạn';
  if (v.usedByMe) return 'Bạn đã dùng voucher này';
  if (v.remaining <= 0) return 'Voucher đã hết lượt';
  if (new Date(v.startsAt) > now) return `Dùng từ ${vnDayMonth(v.startsAt)}`;
  if (subtotal < v.minOrder) return `Mua thêm ${fmtVND(v.minOrder - subtotal)} để dùng`;
  return null;
}

/** Voucher dùng được và giảm nhiều nhất (hoà thì chọn cái sắp hết hạn trước). */
export function bestVoucher(
  vouchers: StorefrontVoucher[] | undefined,
  subtotal: number,
  now = new Date(),
): StorefrontVoucher | null {
  const usable = (vouchers ?? []).filter((v) => !voucherBlocker(v, subtotal, now));
  usable.sort(
    (a, b) =>
      voucherDiscount(b, subtotal) - voucherDiscount(a, subtotal) ||
      new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
  );
  return usable[0] ?? null;
}

export const voucherStateLabels: Record<VoucherState, { label: string; tone: string }> = {
  running: { label: 'Đang chạy', tone: 'success' },
  scheduled: { label: 'Sắp diễn ra', tone: 'info' },
  exhausted: { label: 'Hết lượt', tone: 'warning' },
  ended: { label: 'Đã kết thúc', tone: 'neutral' },
  stopped: { label: 'Đã dừng', tone: 'neutral' },
};

/** Số tiền khách phải trả: tổng đã chốt, hoặc tạm tính trừ voucher khi chưa chốt. */
export function orderPayable(order: { estimatedTotal: number; finalTotal: number | null; discountAmount?: number }): number {
  return order.finalTotal ?? order.estimatedTotal - (order.discountAmount ?? 0);
}
