import { describe, expect, it } from 'vitest';
import { apiFulfillment, availabilityRanges, buildIntentPayload, buildChoosePayload, dateRange, formatMatchingVND, sortMatches, slotLabel } from './matchingLogic';
import type { Match, ParsedIntent } from '../../../services/agrilink-matching.types';

const parsed: ParsedIntent = { side: 'sell', cropId: 'crop', cropName: 'Cà phê', cropCandidates: [], productQuery: null, quantityKg: 5000, quantityText: '5 tấn', provinceCode: 'dak-lak', communeCode: null, placeSource: 'text', windowStart: '2026-09-28', windowEnd: '2026-10-04', expectedPricePerKg: null, fulfillmentPref: 'any', missing: [], followUp: null, confidence: 0.9 };
describe('matching buyer logic', () => {
  it('rounds fractional prices to whole đồng', () => {
    expect(formatMatchingVND(319987.873)).toBe('319.988 ₫');
  });
  it('builds only declared create DTO fields', () => {
    expect(buildIntentPayload('Tôi bán cà phê', parsed)).toEqual({ rawText: 'Tôi bán cà phê', side: 'sell', cropId: 'crop', quantityKg: 5000, quantityText: '5 tấn', provinceCode: 'dak-lak', windowStart: '2026-09-28', windowEnd: '2026-10-04', fulfillmentPref: 'any' });
  });
  it('builds only declared choose DTO fields', () => {
    expect(buildChoosePayload({ organizationId: 'dealer', side: 'buy', fulfillment: 'delivery', slot: { date: '2026-10-01', session: 'morning' }, contactName: 'A B', contactPhone: '0912345678', address: '', items: [] })).toEqual({ organizationId: 'dealer', fulfillment: 'delivery', scheduledDate: '2026-10-01', scheduledSession: 'morning', contactName: 'A B', contactPhone: '0912345678' });
  });
  it('maps on-screen fulfillment to the API codes the choose endpoint accepts', () => {
    // Bán: "Đại lý đến lấy" → delivery (farm_pickup), "Tôi tự đến" → at_dealer. Mua: "Tôi tự đến" → pickup, "Đại lý giao" → delivery.
    expect(apiFulfillment('sell', 'pickup')).toBe('delivery');
    expect(apiFulfillment('sell', 'at_dealer')).toBe('at_dealer');
    expect(apiFulfillment('buy', 'at_dealer')).toBe('pickup');
    expect(apiFulfillment('buy', 'delivery')).toBe('delivery');
    expect(buildChoosePayload({ organizationId: 'd', side: 'sell', fulfillment: 'pickup', contactName: 'A B', contactPhone: '0912345678' }).fulfillment).toBe('delivery');
  });
  it('sorts with null values last and keeps the input intact', () => {
    const data = [{ score: 70, effectivePrice: null, distanceKm: null }, { score: 90, effectivePrice: 120, distanceKm: 30 }, { score: 80, effectivePrice: 130, distanceKm: 10 }] as Match[];
    expect(sortMatches(data, 'price').map(x => x.score)).toEqual([80, 90, 70]);
    expect(sortMatches(data, 'distance').map(x => x.score)).toEqual([80, 90, 70]);
    expect(data[0].score).toBe(70);
  });
  it('uses local calendar dates and caps availability at 14 days', () => {
    expect(dateRange('2026-10-01', '2026-10-30')).toEqual(['2026-10-01', '2026-10-14']);
    expect(availabilityRanges('2026-10-01', '2026-10-30')).toEqual([['2026-10-01','2026-10-14'],['2026-10-15','2026-10-28'],['2026-10-29','2026-10-30']]);
    expect(slotLabel({ date: '2026-10-01', session: 'afternoon' })).toContain('Chiều');
  });
});
