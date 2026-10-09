import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { agrilinkManageApi, agrilinkPlatformApi } from './agrilink.service';
import { matchingApi } from './agrilink-matching.service';

vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  const response = { data: { data: 'ok' } };
  vi.mocked(api.get).mockResolvedValue(response);
  vi.mocked(api.post).mockResolvedValue(response);
  vi.mocked(api.patch).mockResolvedValue(response);
  vi.mocked(api.put).mockResolvedValue(response);
});
describe('Wave 2 dealer API contracts', () => {
  it('sends the declared buy-offer fields and freshness calls', async () => {
    await agrilinkManageApi.buyOffers();
    await agrilinkManageApi.addBuyOffer({ cropId: 'crop', title: 'Thu mua tiêu', unit: 'kg', price: 120000, maxQuantityKg: 500 });
    await agrilinkManageApi.updateBuyOffer('offer', { price: 121000 });
    await agrilinkManageApi.confirmBuyOffer('offer');
    await agrilinkManageApi.confirmAllBuyOffers();
    expect(vi.mocked(api.get).mock.calls).toEqual([['/marketplace/manage/buy-offers']]);
    expect(vi.mocked(api.patch).mock.calls).toEqual([['/marketplace/manage/buy-offers/offer', { price: 121000 }]]);
    expect(vi.mocked(api.post).mock.calls).toEqual([
      ['/marketplace/manage/buy-offers', { cropId: 'crop', title: 'Thu mua tiêu', unit: 'kg', price: 120000, maxQuantityKg: 500 }],
      ['/marketplace/manage/buy-offers/offer/confirm-price'],
      ['/marketplace/manage/buy-offers/confirm-all'],
    ]);
  });
  it('uses service and lead paths with exact bodies', async () => {
    const service = { active: true, cropIds: [], areaMode: 'provinces' as const, radiusKm: null, provinceCodes: ['dak-lak'], feeMode: 'free' as const, feeAmount: 0, minQuantityKg: 0, leadTimeHours: 0, note: '', windows: [{ weekday: 1, session: 'morning' as const, capacity: 3 }] };
    await agrilinkManageApi.services();
    await agrilinkManageApi.putService('farm_pickup', service);
    await matchingApi.leads('sell', 'crop');
    await matchingApi.leadOffers('pending');
    await matchingApi.createLeadOffer('intent', { pricePerKg: 100000, fulfillment: 'at_dealer', feePerKg: 0 });
    await matchingApi.withdrawLeadOffer('offer');
    expect(vi.mocked(api.put).mock.calls).toEqual([['/marketplace/manage/services/farm_pickup', service]]);
    expect(vi.mocked(api.get).mock.calls).toEqual([
      ['/marketplace/manage/services'],
      ['/marketplace/manage/leads', { params: { side: 'sell', cropId: 'crop' } }],
      ['/marketplace/manage/lead-offers', { params: { status: 'pending' } }],
    ]);
    expect(vi.mocked(api.post).mock.calls).toEqual([
      ['/marketplace/manage/leads/intent/offers', { pricePerKg: 100000, fulfillment: 'at_dealer', feePerKg: 0 }],
      ['/marketplace/manage/lead-offers/offer/withdraw'],
    ]);
  });
  it('uses rating, verification and platform decision contracts', async () => {
    await agrilinkManageApi.ratings(2);
    await agrilinkManageApi.verification();
    await agrilinkManageApi.submitVerification({ legalName: 'Đại lý An Phú', taxCode: '0123456789', businessAddress: 'Đắk Lắk' });
    await agrilinkPlatformApi.verifications('pending');
    await agrilinkPlatformApi.decide('org', 'reject', 'Thiếu thông tin');
    expect(vi.mocked(api.get).mock.calls).toEqual([
      ['/marketplace/manage/ratings', { params: { page: 2 } }],
      ['/marketplace/manage/verification'],
      ['/platform/agrilink/verifications', { params: { status: 'pending' } }],
    ]);
    expect(vi.mocked(api.post).mock.calls).toEqual([
      ['/marketplace/manage/verification', { legalName: 'Đại lý An Phú', taxCode: '0123456789', businessAddress: 'Đắk Lắk' }],
      ['/platform/agrilink/verifications/org/reject', { note: 'Thiếu thông tin' }],
    ]);
  });
});
