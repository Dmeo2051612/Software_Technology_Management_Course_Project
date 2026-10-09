import { Injectable } from '@nestjs/common';
import { IntentForMatch, ScoredMatch } from './scoring';

export interface MatchExplainer {
  explain(intent: IntentForMatch, match: ScoredMatch): string[];
}
export const MATCH_EXPLAINER = 'MATCH_EXPLAINER';
const money = (n: number) => Math.round(n).toLocaleString('vi-VN');
const tonnes = (kg: number) =>
  (kg / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const sessionLabel = (session: {
  date: string;
  session: 'morning' | 'afternoon';
}) => {
  const weekday = new Date(`${session.date}T00:00:00Z`).getUTCDay();
  const day =
    weekday === 0
      ? 'Chủ nhật'
      : `thứ ${['', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy'][weekday]}`;
  return `${session.session === 'morning' ? 'sáng' : 'chiều'} ${day} ${session.date.slice(8, 10)}/${session.date.slice(5, 7)}`;
};
@Injectable()
export class TemplateMatchExplainer implements MatchExplainer {
  explain(i: IntentForMatch, m: ScoredMatch): string[] {
    const reasons: string[] = [];
    if (i.side === 'sell' && m.offer && m.effectivePrice !== null) {
      reasons.push(
        `Giá thực nhận ~${money(m.effectivePrice)}đ/kg (giá thu ${money(m.offer.price)}đ, phí ${m.pickup?.available && i.fulfillmentPref !== 'dropoff' ? 'lấy hàng' : 'vận chuyển'} ${money(m.offer.price - m.effectivePrice)}đ/kg)`,
      );
      if (m.pickup?.available)
        reasons.push(
          m.pickup.nextSession
            ? `Đến tận vườn lấy hàng — còn lịch ${sessionLabel(m.pickup.nextSession)}`
            : 'Có dịch vụ đến tận vườn lấy hàng',
        );
      if (
        m.offer.maxQuantityKg !== null &&
        i.quantityKg !== null &&
        m.offer.maxQuantityKg < i.quantityKg
      )
        reasons.push(`Chỉ thu tối đa ${tonnes(m.offer.maxQuantityKg)} tấn`);
    } else if (i.side === 'buy') {
      if (m.products?.length)
        reasons.push(
          `Có ${m.products.length} sản phẩm phù hợp: ${m.products[0].name}`,
        );
      if (m.products?.some((p) => p.inStock)) reasons.push('Có hàng trong kho');
      if (m.delivery?.available)
        reasons.push(
          m.delivery.nextSession
            ? `Có giao tận nơi — lịch ${sessionLabel(m.delivery.nextSession)}`
            : 'Có dịch vụ giao tận nơi',
        );
    }
    if (m.distanceKm !== null)
      reasons.push(m.distanceKm < 1 ? 'Ở rất gần, dưới 1 km' : `Cách khoảng ${Math.round(m.distanceKm)} km`);
    if (i.side === 'sell' && m.market && m.vsMarketPct != null) {
      const where = m.market.scope === 'province' ? `giá thị trường ${m.market.provinceName} hôm nay` : 'giá bình quân khu vực';
      const amount = `${money(m.market.pricePerKg)}đ/kg`;
      const pct = Math.abs(m.vsMarketPct).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
      reasons.push(Math.abs(m.vsMarketPct) < 0.5 ? `Bằng ${where} (${amount})` : `${m.vsMarketPct > 0 ? 'Cao hơn' : 'Thấp hơn'} ${where} ${pct}% (${amount})`);
    }
    if (m.dealer.verified) reasons.push('Đại lý đã xác minh giấy phép kinh doanh');
    reasons.push(
      m.reliability.ratingCount >= 3 && m.reliability.avgStars != null
        ? `${m.reliability.avgStars.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}★ từ ${m.reliability.ratingCount} đánh giá${m.reliability.accurateWeightPct == null ? '' : ` · ${m.reliability.accurateWeightPct}% cân đúng`}`
        : m.completedOrders
        ? `Đã hoàn thành ${m.completedOrders} giao dịch trên AgriLink`
        : 'Đại lý mới trên AgriLink',
    );
    return reasons;
  }
}
