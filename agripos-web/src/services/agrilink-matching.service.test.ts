import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { matchingApi } from './agrilink-matching.service';

vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.get).mockResolvedValue({ data: { data: 'ok' } }); vi.mocked(api.post).mockResolvedValue({ data: { data: 'ok' } }); });
describe('matching API contract', () => {
  it('uses exact write methods, paths and bodies', async () => {
    const input = { rawText: 'Bán cà phê', side: 'sell' as const, cropId: 'crop', quantityKg: 100, provinceCode: 'dak-lak', windowStart: '2026-09-28', windowEnd: '2026-10-01', fulfillmentPref: 'any' as const };
    await matchingApi.parse('Bán cà phê'); await matchingApi.create(input);
    await matchingApi.close('i');
    const choose = { organizationId: 'd', fulfillment: 'at_dealer' as const, contactName: 'A B', contactPhone: '0912345678' };
    await matchingApi.choose('i', choose);
    await matchingApi.accept('i', 'o', { contactName: 'A B', contactPhone: '0912345678' });
    await matchingApi.decline('i', 'o');
    await matchingApi.rate('order', { stars: 5, accurateWeight: true });
    expect(vi.mocked(api.post).mock.calls).toEqual([
      ['/marketplace/intents/parse', { text: 'Bán cà phê' }],
      ['/marketplace/intents', input],
      ['/marketplace/my-intents/i/close', {}],
      ['/marketplace/my-intents/i/choose', choose],
      ['/marketplace/my-intents/i/offers/o/accept', { contactName: 'A B', contactPhone: '0912345678' }],
      ['/marketplace/my-intents/i/offers/o/decline'],
      ['/marketplace/my-orders/order/rating', { stars: 5, accurateWeight: true }],
    ]);
  });
  it('uses exact read paths and query objects', async () => {
    await matchingApi.mine('open'); await matchingApi.detail('i'); await matchingApi.availability('d', 'farm_pickup', '2026-10-01', '2026-10-14');
    await matchingApi.crops(); await matchingApi.provinces(); await matchingApi.communes('dak-lak', 'Buôn'); await matchingApi.resolvePlace('Cư Mgar'); await matchingApi.dailyPrices();
    expect(vi.mocked(api.get).mock.calls.map(([path, config]) => [path, config])).toEqual([
      ['/marketplace/my-intents', { params: { status: 'open' } }],
      ['/marketplace/my-intents/i', undefined],
      ['/marketplace/dealers/d/availability', { params: { kind: 'farm_pickup', from: '2026-10-01', to: '2026-10-14' } }],
      ['/agri/crops', undefined], ['/agri/provinces', undefined],
      ['/agri/provinces/dak-lak/communes', { params: { q: 'Buôn' } }],
      ['/agri/resolve-place', { params: { q: 'Cư Mgar' } }],
      ['/agri/daily-prices', undefined],
    ]);
  });
});
