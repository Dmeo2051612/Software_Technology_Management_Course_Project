import type { CompleteInput, MatchData, OrderDetail } from '../../../services/agrilink.types';
import { validPrice, validQuantity } from '../validation';
import { voucherDiscount } from '../voucher';

export type CompleteForm = {
  party: { mode: 'linked' | 'suggestion' | 'new' | 'none'; id?: string };
  lines: Record<string, { quantity: number; unitPrice: number }>;
  weights: number[];
  pricePerKg: number;
  weighDate: string;
  paymentMethod: 'cash' | 'transfer' | 'debt' | 'partial';
  paidAmount: number;
};
/**
 * Whether the party chosen on step 1 (customer/farmer) is valid to move past.
 * "Tạo mới" (create new from the order's own contact info) never depends on the
 * `/match` suggestion lookup having succeeded, so a dealer can always finish an order
 * even when that request fails — only picking an existing linked/suggested party
 * requires `match` to have loaded.
 */
export function canConfirmParty(party: CompleteForm['party'], match: MatchData | null): boolean {
  if (party.mode === 'new') return true;
  return !!match && !!party.id;
}
export function completeTotal(order: OrderDetail, form: CompleteForm): number {
  return order.kind === 'sell'
    ? Math.round(form.weights.reduce((a, b) => a + b, 0) * form.pricePerKg)
    : order.items.reduce((sum, item) => {
        const line = form.lines[item.id];
        return sum + Math.round((line?.quantity || 0) * (line?.unitPrice || 0));
      }, 0);
}
/** Tiền giảm voucher tính lại trên tổng chốt (như máy chủ); 0 nếu đơn không dùng voucher. */
export function completeDiscount(order: OrderDetail, form: CompleteForm): number {
  if (order.kind !== 'buy' || !order.voucherRule) return 0;
  return voucherDiscount({ ...order.voucherRule, minOrder: 0 }, completeTotal(order, form));
}
export function validateCompleteForm(order: OrderDetail, form: CompleteForm): string | null {
  if (form.party.mode !== 'new' && !form.party.id)
    return order.kind === 'sell' ? 'Vui lòng chọn nông dân.' : 'Vui lòng chọn khách hàng.';
  if (order.kind === 'buy') {
    if (order.items.some((item) => !validQuantity(form.lines[item.id]?.quantity)))
      return 'Số lượng từng dòng phải lớn hơn 0 và có tối đa 3 chữ số thập phân.';
    if (order.items.some((item) => !validPrice(form.lines[item.id]?.unitPrice)))
      return 'Đơn giá không hợp lệ (tối đa 2 chữ số thập phân).';
  } else {
    if (!form.weights.length || form.weights.some((x) => !validQuantity(x)))
      return 'Vui lòng nhập ít nhất một lần cân hợp lệ (tối đa 3 chữ số thập phân).';
    if (!validPrice(form.pricePerKg) || form.pricePerKg <= 0)
      return 'Giá mỗi kg phải lớn hơn 0 và có tối đa 2 chữ số thập phân.';
    if (!form.weighDate) return 'Vui lòng chọn ngày cân.';
  }
  const total = completeTotal(order, form) - completeDiscount(order, form);
  if (!validPrice(form.paidAmount) || form.paidAmount > total)
    return 'Số tiền đã trả vượt giá trị đơn hoặc có quá 2 chữ số thập phân.';
  if (
    order.kind === 'buy' &&
    form.paymentMethod === 'partial' &&
    (form.paidAmount <= 0 || form.paidAmount >= total)
  )
    return 'Trả một phần phải lớn hơn 0 và nhỏ hơn tổng tiền.';
  return null;
}
export function buildCompletePayload(order: OrderDetail, form: CompleteForm): CompleteInput {
  const party =
    form.party.mode === 'new'
      ? { createNew: true as const }
      : order.kind === 'buy'
        ? { customerId: form.party.id! }
        : { farmerId: form.party.id! };
  if (order.kind === 'sell')
    return {
      party: party as { farmerId: string } | { createNew: true },
      weights: form.weights,
      pricePerKg: form.pricePerKg,
      paidAmount: form.paidAmount,
      weighDate: form.weighDate,
    };
  const total = completeTotal(order, form) - completeDiscount(order, form);
  return {
    party: party as { customerId: string } | { createNew: true },
    items: order.items.map((item) => ({ itemId: item.id, ...form.lines[item.id] })),
    paymentMethod: form.paymentMethod === 'partial' ? 'cash' : form.paymentMethod,
    paidAmount:
      form.paymentMethod === 'debt'
        ? 0
        : form.paymentMethod === 'partial'
          ? form.paidAmount
          : total,
  };
}
