/** Form tạo/sửa voucher: chuyển đổi giữa ô nhập và dữ liệu gửi API. */
import type { ManagedVoucher, VoucherInput, VoucherType } from '../../../services/agrilink.types';
import { formatMoney, parseMoney } from '../../../utils/formatters';
import { saleEndDateInput, saleEndIso } from '../listing';
import { voucherStartIso } from '../voucher';

export interface VoucherForm {
  title: string;
  type: VoucherType;
  value: string;
  maxDiscount: string;
  minOrder: string;
  quantity: string;
  /** YYYY-MM-DD theo giờ Việt Nam. */
  start: string;
  end: string;
}
export type VoucherFullInput = Required<Omit<VoucherInput, 'active'>>;

/** Hôm nay theo giờ Việt Nam (không phụ thuộc múi giờ của máy). */
export const vnToday = (now = new Date()) => saleEndDateInput(now.toISOString());

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function initialVoucherForm(v: ManagedVoucher | null, today = vnToday()): VoucherForm {
  if (!v)
    return { title: '', type: 'amount', value: '', maxDiscount: '', minOrder: '', quantity: '100', start: today, end: addDays(today, 30) };
  return {
    title: v.title,
    type: v.type,
    value: v.type === 'amount' ? formatMoney(String(v.value)) : String(v.value),
    maxDiscount: v.maxDiscount == null ? '' : formatMoney(String(v.maxDiscount)),
    minOrder: formatMoney(String(v.minOrder)),
    quantity: String(v.quantity),
    start: saleEndDateInput(v.startsAt),
    end: saleEndDateInput(v.endsAt),
  };
}

export function voucherFormInput(f: VoucherForm): VoucherFullInput {
  return {
    title: f.title.trim(),
    type: f.type,
    value: f.type === 'amount' ? parseMoney(f.value) : Number(f.value),
    maxDiscount: f.type === 'percent' ? parseMoney(f.maxDiscount) || null : null,
    minOrder: parseMoney(f.minOrder),
    quantity: Number(f.quantity),
    startsAt: voucherStartIso(f.start),
    endsAt: saleEndIso(f.end),
  };
}

const FIELD_OF: Record<keyof VoucherFullInput, keyof VoucherForm> = {
  title: 'title',
  type: 'type',
  value: 'value',
  maxDiscount: 'maxDiscount',
  minOrder: 'minOrder',
  quantity: 'quantity',
  startsAt: 'start',
  endsAt: 'end',
};

/**
 * Chỉ các trường người dùng đã đổi — so theo ô nhập, vì giờ gốc có thể lẻ phút
 * và voucher đã có người dùng bị từ chối nếu gửi lại ngày bắt đầu khác.
 */
export function voucherPatch(voucher: ManagedVoucher, form: VoucherForm): VoucherInput {
  const before = initialVoucherForm(voucher);
  const input = voucherFormInput(form);
  return Object.fromEntries(
    (Object.keys(FIELD_OF) as (keyof VoucherFullInput)[])
      .filter((k) => form[FIELD_OF[k]] !== before[FIELD_OF[k]])
      .map((k) => [k, input[k]]),
  ) as VoucherInput;
}
