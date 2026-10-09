import { BadRequestException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

jest.mock('sharp', () => jest.fn());
jest.mock('node:fs/promises', () => ({ mkdir: jest.fn().mockResolvedValue(undefined) }));

const farmer = { id: 'farmer-1', role: 'farmer', memberships: [], organizationId: null, suspended: false } as any;

function fakeDb(rows: Record<string, any[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    const key = Object.keys(rows).find((k) => sql.includes(k));
    return Promise.resolve(key ? rows[key] : []);
  });
  return { db: { query, transaction: (cb: any) => cb({ query }) } as any, calls };
}

const voucherRow = {
  id: 'v-1',
  title: 'Giảm 20K đơn từ 500K',
  discount_type: 'amount',
  value: '20000',
  max_discount: null,
  min_order: '500000',
  quantity: 100,
  used_count: 0,
  starts_at: new Date(Date.now() - 86400000),
  ends_at: new Date(Date.now() + 10 * 86400000),
  active: true,
};
const orderRows = {
  'FROM agrilink_organizations': [{ id: 'org-1', fulfillment_options: ['pickup'] }],
  'FROM agrilink_offers': [{ id: 'of-1', kind: 'sale', product_id: 'p-1', name: 'NPK', unit: 'bao', price: 350000 }],
  'FROM agrilink_vouchers WHERE id=$1': [voucherRow],
  'SELECT order_id FROM agrilink_voucher_claims': [{ order_id: null }],
  'MAX(CAST': [{ max_num: 0 }],
  'INSERT INTO agrilink_orders': [{ id: 'al-1' }],
};
const buy = {
  kind: 'buy' as const,
  fulfillment: 'pickup' as const,
  contactName: 'Anh Ba',
  contactPhone: '0901234567',
  items: [{ offerId: 'of-1', quantity: 2 }],
  voucherId: 'v-1',
};

describe('placing an order with a dealer voucher', () => {
  it('stores the server-computed discount and marks the voucher used by the order', async () => {
    const { db, calls } = fakeDb(orderRows);
    const svc = new MarketplaceService(db, {} as any);
    jest.spyOn(svc, 'myOrder').mockResolvedValue({ id: 'al-1' } as any);
    await svc.placeOrder(farmer, 'org-1', buy);

    expect(calls.find(([s]) => s.includes('FROM agrilink_vouchers WHERE id=$1'))![1]).toEqual(['v-1', 'org-1']);
    const [sql, params] = calls.find(([s]) => s.includes('INSERT INTO agrilink_orders'))!;
    expect(sql).toContain('"voucherId","voucherSnapshot","discountAmount"');
    expect(params.slice(-3)).toEqual([
      'v-1',
      JSON.stringify({ title: 'Giảm 20K đơn từ 500K', type: 'amount', value: 20000, maxDiscount: null }),
      20000,
    ]);
    // estimatedTotal vẫn là tổng tiền hàng trước voucher.
    expect(params[9]).toBe(700000);
    expect(calls.some(([s]) => s.includes('used_count=used_count+1'))).toBe(true);
    const link = calls.find(([s]) => s.includes('SET order_id=$3,used_at=now()'))!;
    expect(link[1]).toEqual(['v-1', 'farmer-1', 'al-1']);
  });

  it('places a plain order without touching vouchers', async () => {
    const { db, calls } = fakeDb(orderRows);
    const svc = new MarketplaceService(db, {} as any);
    jest.spyOn(svc, 'myOrder').mockResolvedValue({ id: 'al-1' } as any);
    const { voucherId: _unused, ...plain } = buy;
    await svc.placeOrder(farmer, 'org-1', plain);
    expect(calls.some(([s]) => s.includes('agrilink_voucher'))).toBe(false);
    expect(calls.find(([s]) => s.includes('INSERT INTO agrilink_orders'))![1].slice(-3)).toEqual([null, null, 0]);
  });

  it('refuses a voucher on a sell order or an order made from a matched intent', async () => {
    const { db } = fakeDb(orderRows);
    const svc = new MarketplaceService(db, {} as any);
    const sell = { ...buy, kind: 'sell' as const, fulfillment: 'at_dealer' as const };
    await expect(svc.placeOrder(farmer, 'org-1', sell)).rejects.toThrow('Voucher chỉ dùng cho đơn mua vật tư');
    await expect(
      svc.placeOrderTx({ query: db.query } as any, farmer, 'org-1', buy, { intentId: 'intent-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('surfaces why the voucher cannot be used', async () => {
    const { db } = fakeDb(orderRows);
    const svc = new MarketplaceService(db, {} as any);
    await expect(
      svc.placeOrder(farmer, 'org-1', { ...buy, items: [{ offerId: 'of-1', quantity: 1 }] }),
    ).rejects.toThrow('Đơn tối thiểu 500.000 đ.');
  });
});

describe('cancelling a voucher order', () => {
  it('gives the voucher use back to the farmer', async () => {
    const { db, calls } = fakeDb({
      'FROM agrilink_orders WHERE id=$1': [
        { id: 'al-1', status: 'pending', fulfillment: 'pickup', organizationId: 'org-1', requesterId: 'farmer-1', voucherId: 'v-1' },
      ],
      'SET order_id=NULL': [{ voucher_id: 'v-1' }],
      'FROM users': [{ fullName: 'Anh Ba' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    jest.spyOn(svc, 'myOrder').mockResolvedValue({ id: 'al-1' } as any);
    await svc.cancelMyOrder(farmer, 'al-1');
    expect(calls.find(([s]) => s.includes('SET order_id=NULL'))![1]).toEqual(['v-1', 'al-1']);
    expect(calls.some(([s]) => s.includes('used_count=GREATEST(used_count-1,0)'))).toBe(true);
  });
});
