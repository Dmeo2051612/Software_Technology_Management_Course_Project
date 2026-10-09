import { normalizeVi } from '../agri-reference/normalize';
import { BUY_OFFER_STALE_HOURS } from '../marketplace/trust-pricing';
import { DEFAULT_MAX_KM, distanceKm, IntentForMatch, productTokens } from './scoring';

/**
 * Khi không có đại lý nào đủ điều kiện gợi ý: giải thích vì sao và đưa ra các đại lý "gần phù hợp"
 * (thiếu đúng một vài điều kiện). Hàm thuần, không đọc CSDL; dữ liệu do AgrilinkIntentsService truyền vào.
 * Đại lý gần phù hợp chỉ để tham khảo, không được chọn đặt lịch trực tiếp (chọn đại lý vẫn yêu cầu đủ điều kiện).
 */
export type NearDealer = { id: string; name: string; logoUrl: string | null; provinceName: string | null; verified: boolean };
export type NearMatch = {
  dealer: NearDealer;
  distanceKm: number | null;
  offer: { title: string; cropName: string; price: number; unit: string; priceUpdatedAt: string } | null;
  products: { name: string; price: number; unit: string; inStock: boolean }[];
  gaps: string[];
};
export type NoMatch = { reasons: string[]; near: NearMatch[] };

/** Vùng phục vụ của dịch vụ đến lấy hàng / giao hàng đang bật (nếu có). */
export type ServiceArea = { areaMode: 'radius' | 'provinces'; radiusKm: number | null; provinceCodes: string[] } | null;
const covers = (a: ServiceArea, provinceCode: string, d: number | null) =>
  !!a && (a.areaMode === 'provinces' ? a.provinceCodes.includes(provinceCode) : d !== null && a.radiusKm !== null && d <= a.radiusKm);

/** Một tin thu mua đang mở của đại lý khác (mọi độ mới giá, mọi hạn), kèm toạ độ đại lý. */
export type BuyOfferRow = NearDealer & {
  lat: number | null; lng: number | null; pickup: ServiceArea;
  title: string; cropId: string; cropName: string; price: number; unit: string;
  maxQuantityKg: number | null; priceUpdatedAt: string | Date; validUntil: string | null;
};
/** Một sản phẩm đang đăng bán của đại lý khác, kèm toạ độ đại lý. */
export type SaleOfferRow = NearDealer & {
  lat: number | null; lng: number | null; delivery: ServiceArea;
  productName: string; price: number; unit: string; inStock: boolean;
};

const LIMIT = 5;
const kg = (n: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(n))} kg`;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const iso = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString());
const pick = ({ id, name, logoUrl, provinceName, verified }: NearDealer): NearDealer => ({ id, name, logoUrl, provinceName, verified: !!verified });
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Giữ một dòng tốt nhất mỗi đại lý, xếp ít thiếu sót trước rồi gần trước. */
function best(list: (NearMatch & { rank: number })[]) {
  const seen = new Set<string>();
  return list
    .sort((a, b) => a.rank - b.rank || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    .filter((x) => !seen.has(x.dealer.id) && seen.add(x.dealer.id))
    .slice(0, LIMIT)
    .map(({ rank, ...x }) => x);
}

export function sellNoMatch(i: IntentForMatch, cropName: string, rows: BuyOfferRow[], now: Date): NoMatch {
  const near: (NearMatch & { rank: number })[] = [];
  let exact = 0, stale = 0, expired = 0, far = 0;
  let maxCapacity = 0;
  for (const r of rows) {
    const same = r.cropId === i.cropId;
    const d = distanceKm(i, r);
    const ageHours = (now.getTime() - new Date(r.priceUpdatedAt).getTime()) / 3600e3;
    const gaps: string[] = [];
    if (!same) gaps.push(`Thu mua ${r.cropName}, không phải ${cropName}`);
    if (ageHours > BUY_OFFER_STALE_HOURS) gaps.push(`Giá cập nhật ${Math.max(2, Math.floor(ageHours / 24))} ngày trước, cần hỏi lại giá`);
    if (r.validUntil && r.validUntil < i.windowStart) gaps.push(`Tin thu mua hết hạn ngày ${ddmm(r.validUntil)}`);
    const tooFar = d !== null && d > DEFAULT_MAX_KM && !covers(r.pickup, i.provinceCode, d);
    if (tooFar) gaps.push(`Cách khoảng ${Math.round(d)} km, ngoài phạm vi ${DEFAULT_MAX_KM} km`);
    if (r.maxQuantityKg != null && i.quantityKg != null && r.maxQuantityKg < i.quantityKg) gaps.push(`Chỉ nhận tối đa ${kg(r.maxQuantityKg)}`);
    if (same) {
      exact++;
      if (ageHours > BUY_OFFER_STALE_HOURS) stale++;
      if (r.validUntil && r.validUntil < i.windowStart) expired++;
      if (tooFar) far++;
      maxCapacity = Math.max(maxCapacity, r.maxQuantityKg ?? Infinity);
    }
    near.push({
      dealer: pick(r), distanceKm: round1(d), products: [], gaps,
      offer: { title: r.title, cropName: r.cropName, price: Number(r.price), unit: r.unit, priceUpdatedAt: iso(r.priceUpdatedAt) },
      rank: (same ? 0 : 10) + gaps.length,
    });
  }
  const reasons: string[] = [];
  if (!exact) reasons.push(`Hiện chưa có đại lý nào đang đăng tin thu mua ${cropName}.`);
  if (stale) reasons.push(`${stale} đại lý thu mua ${cropName} chưa cập nhật giá trong ${BUY_OFFER_STALE_HOURS} giờ qua, nên chưa được gợi ý.`);
  if (expired) reasons.push(`${expired} tin thu mua ${cropName} đã hết hạn trước ngày ${ddmm(i.windowStart)}.`);
  if (far) reasons.push(`${far} đại lý thu mua ${cropName} ở xa hơn ${DEFAULT_MAX_KM} km và không có dịch vụ đến lấy hàng tại tỉnh của bạn.`);
  if (exact && i.quantityKg != null && maxCapacity < i.quantityKg)
    reasons.push(`Khối lượng ${kg(i.quantityKg)} lớn hơn mức tối đa các đại lý đang nhận (${kg(maxCapacity)}); có thể chia thành nhiều đơn.`);
  if (exact && !reasons.length) reasons.push(`Các đại lý thu mua ${cropName} chưa đáp ứng điều kiện trong khoảng ngày bạn chọn.`);
  return { reasons, near: best(near) };
}

export function buyNoMatch(i: IntentForMatch, rows: SaleOfferRow[]): NoMatch {
  const tokens = productTokens(i.productQuery ?? '');
  const near: (NearMatch & { rank: number })[] = [];
  let full = 0, farFull = 0;
  const byDealer = new Map<string, { row: SaleOfferRow; hits: { p: SaleOfferRow; matched: number }[] }>();
  for (const r of rows) {
    const words = normalizeVi(r.productName).split(' ');
    const matched = tokens.filter((t) => words.includes(t)).length;
    if (!matched) continue;
    const e = byDealer.get(r.id) ?? { row: r, hits: [] };
    e.hits.push({ p: r, matched });
    byDealer.set(r.id, e);
  }
  for (const { row, hits } of byDealer.values()) {
    hits.sort((a, b) => b.matched - a.matched || Number(b.p.inStock) - Number(a.p.inStock));
    const top = hits[0];
    const d = distanceKm(i, row);
    const gaps: string[] = [];
    const isFull = tokens.length > 0 && top.matched === tokens.length;
    if (!isFull) gaps.push(`Chỉ khớp một phần với “${i.productQuery}”`);
    if (!hits.some((h) => h.p.inStock)) gaps.push('Sản phẩm đang hết hàng');
    if (d !== null && d > DEFAULT_MAX_KM && !covers(row.delivery, i.provinceCode, d)) gaps.push(`Cách khoảng ${Math.round(d)} km, ngoài phạm vi ${DEFAULT_MAX_KM} km`);
    if (isFull) { full++; if (gaps.some((g) => g.startsWith('Cách'))) farFull++; }
    near.push({
      dealer: pick(row), distanceKm: round1(d), offer: null, gaps,
      products: hits.slice(0, 3).map(({ p }) => ({ name: p.productName, price: Number(p.price), unit: p.unit, inStock: p.inStock })),
      rank: (isFull ? 0 : 10) + (tokens.length - top.matched) + gaps.length,
    });
  }
  const reasons: string[] = [];
  if (!full) reasons.push(`Chưa có đại lý nào đăng bán đúng “${i.productQuery}”.`);
  if (farFull) reasons.push(`${farFull} đại lý có bán nhưng ở xa hơn ${DEFAULT_MAX_KM} km và không giao tới tỉnh của bạn.`);
  return { reasons, near: best(near) };
}
