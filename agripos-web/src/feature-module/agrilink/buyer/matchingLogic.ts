import type { ChooseIntentInput, CreateIntentInput, Fulfillment, Match, ParsedIntent, Slot } from '../../../services/agrilink-matching.types';
import { fmtVND } from '../../../utils/formatters';

export const roundMatchingVND = (amount: number): number => Math.round(amount);
export const formatMatchingVND = (amount: number): string => fmtVND(roundMatchingVND(amount));

export function buildIntentPayload(rawText: string, parsed: ParsedIntent): CreateIntentInput {
  if (!parsed.side || !parsed.provinceCode) throw new Error('Vui lòng chọn Bán/Mua và địa điểm.');
  if (parsed.side === 'sell' && (!parsed.cropId || !parsed.quantityKg)) throw new Error('Vui lòng chọn nông sản và nhập khối lượng.');
  if (parsed.side === 'buy' && !parsed.productQuery?.trim()) throw new Error('Vui lòng nhập vật tư cần mua.');
  if (!parsed.windowStart || !parsed.windowEnd || parsed.windowEnd < parsed.windowStart) throw new Error('Khoảng ngày không hợp lệ.');
  return {
    rawText: rawText.trim(), side: parsed.side,
    ...(parsed.side === 'sell' ? { cropId: parsed.cropId! } : { productQuery: parsed.productQuery!.trim() }),
    ...(parsed.quantityKg != null ? { quantityKg: parsed.quantityKg } : {}),
    ...(parsed.quantityText ? { quantityText: parsed.quantityText } : {}),
    provinceCode: parsed.provinceCode,
    ...(parsed.communeCode ? { communeCode: parsed.communeCode } : {}),
    windowStart: parsed.windowStart, windowEnd: parsed.windowEnd,
    ...(parsed.expectedPricePerKg != null ? { expectedPricePerKg: parsed.expectedPricePerKg } : {}),
    fulfillmentPref: parsed.fulfillmentPref,
  };
}
/**
 * Màn hình chọn theo nghĩa người dùng ("Đại lý đến lấy", "Tôi tự đến đại lý"), còn API dùng mã theo phía đại lý:
 * bán nông sản thì "delivery" là đại lý đến lấy (farm_pickup); mua vật tư thì "pickup" là nông dân tự đến lấy.
 */
export function apiFulfillment(side: 'sell' | 'buy', fulfillment: Fulfillment): Fulfillment {
  if (side === 'sell') return fulfillment === 'pickup' ? 'delivery' : fulfillment;
  return fulfillment === 'at_dealer' ? 'pickup' : fulfillment;
}
export function buildChoosePayload(input: Omit<ChooseIntentInput, 'scheduledDate' | 'scheduledSession'> & { side: 'sell' | 'buy'; slot?: Slot | null }): ChooseIntentInput {
  return {
    organizationId: input.organizationId, fulfillment: apiFulfillment(input.side, input.fulfillment),
    ...(input.slot ? { scheduledDate: input.slot.date, scheduledSession: input.slot.session } : {}),
    ...(input.items?.length ? { items: input.items.map(({ offerId, quantity }) => ({ offerId, ...(quantity != null ? { quantity } : {}) })) } : {}),
    contactName: input.contactName.trim(), contactPhone: input.contactPhone.trim(),
    ...(input.address?.trim() ? { address: input.address.trim() } : {}),
  };
}
export type MatchSort = 'score' | 'price' | 'distance';
export function sortMatches(matches: Match[], sort: MatchSort): Match[] {
  const compareNullable = (a: number | null, b: number | null, descending: boolean) =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : descending ? b - a : a - b;
  return [...matches].sort((a, b) => sort === 'score' ? b.score - a.score : sort === 'price'
    ? compareNullable(a.effectivePrice, b.effectivePrice, true)
    : compareNullable(a.distanceKm, b.distanceKm, false));
}
export function dateRange(start: string, end: string): [string, string] {
  const cap = new Date(`${start}T00:00:00Z`);
  cap.setUTCDate(cap.getUTCDate() + 13);
  return [start, end < cap.toISOString().slice(0, 10) ? end : cap.toISOString().slice(0, 10)];
}
export function availabilityRanges(start: string, end: string): [string, string][] {
  const ranges: [string, string][] = [];
  let current = start;
  while (current <= end && ranges.length < 5) {
    const range = dateRange(current, end);
    ranges.push(range);
    const next = new Date(`${range[1]}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    current = next.toISOString().slice(0, 10);
  }
  return ranges;
}
export function slotLabel(slot: Slot): string {
  return `${slot.session === 'morning' ? 'Sáng' : 'Chiều'} ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(`${slot.date}T00:00:00Z`))}`;
}
