import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { agrilinkBuyerApi, agrilinkManageApi, channelStatsApi } from './agrilink.service';

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
const methods = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.clearAllMocks();
  for (const method of Object.values(methods))
    method.mockResolvedValue({ data: { data: 'unwrapped' } });
});

describe('AgriLink API contract', () => {
  it('sends the exact request bodies for writes', async () => {
    const placed = {
      kind: 'buy' as const,
      items: [{ offerId: 'offer', quantity: 0.333 }],
      fulfillment: 'pickup' as const,
      contactName: 'Nguyễn A',
      contactPhone: '0912345678',
    };
    await agrilinkBuyerApi.placeOrder('d', placed);
    expect(api.post).toHaveBeenCalledWith('/marketplace/dealers/d/orders', placed);
    const complete = {
      party: { customerId: 'customer' },
      items: [{ itemId: 'item', quantity: 0.333, unitPrice: 1000 }],
      paymentMethod: 'cash' as const,
      paidAmount: 333,
    };
    await agrilinkManageApi.complete('o', complete);
    expect(api.post).toHaveBeenCalledWith('/agrilink-manage/orders/o/complete', complete);
    const profile = { name: 'Đại lý mới', marketplaceEnabled: true };
    await agrilinkManageApi.updateProfile(profile);
    expect(api.patch).toHaveBeenCalledWith('/marketplace/manage/profile', profile);
    expect(api.patch).not.toHaveBeenCalledWith(
      '/marketplace/manage/profile',
      expect.objectContaining({ logoUrl: expect.anything() }),
    );
    const product = { published: true, price: null };
    await agrilinkManageApi.setProduct('p', product);
    expect(api.put).toHaveBeenCalledWith('/marketplace/manage/products/p', product);
    const offer = { title: 'Hồ tiêu', commodityType: 'pepper' as const, unit: 'kg', price: 123.45 };
    await agrilinkManageApi.addBuyOffer(offer);
    expect(api.post).toHaveBeenCalledWith('/marketplace/manage/buy-offers', offer);
    const updated = { price: 124.5, active: false };
    await agrilinkManageApi.updateBuyOffer('b', updated);
    expect(api.patch).toHaveBeenCalledWith('/marketplace/manage/buy-offers/b', updated);
  });
  it('saves listing details and uploads listing images', async () => {
    const input = {
      published: true,
      title: 'NPK 20-20-15',
      unit: 'Bao 50kg',
      description: 'Mô tả',
      images: ['/uploads/listings/o-p-1.webp'],
      salePrice: 420000,
      saleEndsAt: '2026-10-06T16:59:59.000Z',
    };
    await agrilinkManageApi.setProduct('p', input);
    expect(api.put).toHaveBeenLastCalledWith('/marketplace/manage/products/p', input);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await agrilinkManageApi.uploadListingImage('p', file);
    const [url, form, config] = vi.mocked(api.post).mock.lastCall!;
    expect(url).toBe('/marketplace/manage/products/p/images');
    expect((form as FormData).get('file')).toBe(file);
    // api mặc định gửi JSON — thiếu header này thì FormData bị gửi thành {"file":{}}.
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
    await agrilinkManageApi.uploadLogo(file);
    expect(vi.mocked(api.post).mock.lastCall![2]).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
  });
  it('manages dealer vouchers and lets farmers save one', async () => {
    const input = { title: 'Giảm 5%', type: 'percent' as const, value: 5, maxDiscount: 50000, minOrder: 0, quantity: 10 };
    await agrilinkManageApi.createVoucher(input);
    expect(api.post).toHaveBeenLastCalledWith('/marketplace/manage/vouchers', input);
    await agrilinkManageApi.updateVoucher('v', { active: false });
    expect(api.patch).toHaveBeenLastCalledWith('/marketplace/manage/vouchers/v', { active: false });
    await agrilinkManageApi.removeVoucher('v');
    expect(api.delete).toHaveBeenLastCalledWith('/marketplace/manage/vouchers/v');
    expect(await agrilinkManageApi.vouchers()).toBe('unwrapped');
    expect(api.get).toHaveBeenLastCalledWith('/marketplace/manage/vouchers');
    await agrilinkBuyerApi.saveVoucher('v');
    expect(api.post).toHaveBeenLastCalledWith('/marketplace/vouchers/v/save');
  });
  it('sends the crop filter only when a crop is chosen', async () => {
    await agrilinkBuyerApi.dealers('An Phú', 'ho-tieu');
    expect(api.get).toHaveBeenLastCalledWith('/marketplace/dealers', { params: { q: 'An Phú', crop: 'ho-tieu' } });
    await agrilinkBuyerApi.dealers('');
    expect(api.get).toHaveBeenLastCalledWith('/marketplace/dealers', { params: { q: '' } });    await agrilinkBuyerApi.dealers('', '', 'can-tho');
    expect(api.get).toHaveBeenLastCalledWith('/marketplace/dealers', { params: { q: '', province: 'can-tho' } });
  });
  it.each([
    ['dealers', () => agrilinkBuyerApi.dealers('cà phê'), 'get', '/marketplace/dealers'],
    ['storefront', () => agrilinkBuyerApi.storefront('d'), 'get', '/marketplace/dealers/d'],
    [
      'place order',
      () =>
        agrilinkBuyerApi.placeOrder('d', {
          kind: 'buy',
          items: [],
          fulfillment: 'pickup',
          contactName: 'A',
          contactPhone: '1',
        }),
      'post',
      '/marketplace/dealers/d/orders',
    ],
    ['my orders', () => agrilinkBuyerApi.myOrders('pending'), 'get', '/marketplace/my-orders'],
    ['my order', () => agrilinkBuyerApi.myOrder('o'), 'get', '/marketplace/my-orders/o'],
    [
      'cancel my order',
      () => agrilinkBuyerApi.cancelMyOrder('o', 'Lý do'),
      'post',
      '/marketplace/my-orders/o/cancel',
    ],
    ['stats', () => agrilinkManageApi.stats('a', 'b'), 'get', '/agrilink-manage/stats'],
    [
      'orders',
      () => agrilinkManageApi.orders({ status: 'pending' }),
      'get',
      '/agrilink-manage/orders',
    ],
    ['order', () => agrilinkManageApi.order('o'), 'get', '/agrilink-manage/orders/o'],
    ['match', () => agrilinkManageApi.match('o'), 'get', '/agrilink-manage/orders/o/match'],
    [
      'update items',
      () => agrilinkManageApi.updateItems('o', []),
      'patch',
      '/agrilink-manage/orders/o/items',
    ],
    ['confirm', () => agrilinkManageApi.confirm('o'), 'post', '/agrilink-manage/orders/o/confirm'],
    [
      'reject',
      () => agrilinkManageApi.reject('o', 'Lý do'),
      'post',
      '/agrilink-manage/orders/o/reject',
    ],
    ['deliver', () => agrilinkManageApi.deliver('o'), 'post', '/agrilink-manage/orders/o/deliver'],
    [
      'cancel',
      () => agrilinkManageApi.cancel('o', 'Lý do'),
      'post',
      '/agrilink-manage/orders/o/cancel',
    ],
    [
      'complete',
      () =>
        agrilinkManageApi.complete('o', {
          party: { createNew: true },
          items: [],
          paymentMethod: 'cash',
          paidAmount: 0,
        }),
      'post',
      '/agrilink-manage/orders/o/complete',
    ],
    ['profile', () => agrilinkManageApi.profile(), 'get', '/marketplace/manage/profile'],
    [
      'update profile',
      () => agrilinkManageApi.updateProfile({ name: 'A' }),
      'patch',
      '/marketplace/manage/profile',
    ],
    [
      'products',
      () => agrilinkManageApi.products({ published: true }),
      'get',
      '/marketplace/manage/products',
    ],
    [
      'set product',
      () => agrilinkManageApi.setProduct('p', { published: true, price: null }),
      'put',
      '/marketplace/manage/products/p',
    ],
    ['buy offers', () => agrilinkManageApi.buyOffers(), 'get', '/marketplace/manage/buy-offers'],
    [
      'add offer',
      () =>
        agrilinkManageApi.addBuyOffer({
          title: 'A',
          commodityType: 'pepper',
          unit: 'kg',
          price: 1,
        }),
      'post',
      '/marketplace/manage/buy-offers',
    ],
    [
      'update offer',
      () => agrilinkManageApi.updateBuyOffer('b', { price: 2 }),
      'patch',
      '/marketplace/manage/buy-offers/b',
    ],
    [
      'remove offer',
      () => agrilinkManageApi.removeBuyOffer('b'),
      'delete',
      '/marketplace/manage/buy-offers/b',
    ],
    ['channel', () => channelStatsApi.bySource('a', 'b'), 'get', '/orders/stats/by-source'],
  ])('%s uses %s %s and unwraps', async (_name, call, method, path) => {
    expect(await (call as () => Promise<unknown>)()).toBe('unwrapped');
    expect(methods[method as string].mock.calls[0][0]).toBe(path);
  });
  it('serializes the published filter as a string', async () => {
    await agrilinkManageApi.products({ published: true });
    expect(api.get).toHaveBeenCalledWith('/marketplace/manage/products', {
      params: { published: 'true' },
    });
  });
  it('uploads the logo using the file form field', async () => {
    const file = new File(['image'], 'logo.png', { type: 'image/png' });
    await agrilinkManageApi.uploadLogo(file);
    const body = methods.post.mock.calls[0][1] as FormData;
    expect(methods.post.mock.calls[0][0]).toBe('/marketplace/manage/profile/logo');
    expect(body.get('file')).toBe(file);
  });
  it('uploads the cover image using the file form field', async () => {
    const file = new File(['image'], 'cover.jpg', { type: 'image/jpeg' });
    await agrilinkManageApi.uploadCover(file);
    const body = methods.post.mock.calls[0][1] as FormData;
    expect(methods.post.mock.calls[0][0]).toBe('/marketplace/manage/profile/cover');
    expect(body.get('file')).toBe(file);
  });
});
