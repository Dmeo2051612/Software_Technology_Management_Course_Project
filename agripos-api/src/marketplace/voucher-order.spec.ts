import { BadRequestException } from '@nestjs/common';
import { linkVoucherClaim, releaseVoucher, reserveVoucher } from './voucher-order';

const now = new Date('2026-10-01T03:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'v-1',
  title: 'Mùa bón thúc — giảm 5%',
  discount_type: 'percent',
  value: '5',
  max_discount: '50000',
  min_order: '1000000',
  quantity: 50,
  used_count: 3,
  starts_at: new Date('2026-09-25T00:00:00Z'),
  ends_at: new Date('2026-10-15T00:00:00Z'),
  active: true,
  ...over,
});

function fakeQ(rows: Record<string, any[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const q = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    const key = Object.keys(rows).find((k) => sql.includes(k));
    return key ? rows[key] : [];
  });
  return { q, calls };
}
const input = { voucherId: 'v-1', dealerId: 'org-1', userId: 'farmer-1', subtotal: 1340000, now };

describe('reserveVoucher', () => {
  it('locks the dealer voucher, saves it for the farmer and takes one use', async () => {
    const { q, calls } = fakeQ({
      'FROM agrilink_vouchers WHERE id=$1 AND organization_id=$2 FOR UPDATE': [row()],
      'SELECT order_id FROM agrilink_voucher_claims': [{ order_id: null }],
    });
    await expect(reserveVoucher(q, input)).resolves.toEqual({
      voucherId: 'v-1',
      snapshot: { title: 'Mùa bón thúc — giảm 5%', type: 'percent', value: 5, maxDiscount: 50000 },
      discount: 50000,
    });
    expect(calls[0][1]).toEqual(['v-1', 'org-1']);
    const claim = calls.find(([s]) => s.startsWith('INSERT INTO agrilink_voucher_claims'))!;
    expect(claim[0]).toContain('ON CONFLICT DO NOTHING');
    expect(claim[1]).toEqual(['v-1', 'farmer-1', 'org-1']);
    expect(calls.some(([s]) => s.includes('FOR UPDATE') && s.includes('agrilink_voucher_claims'))).toBe(true);
    expect(calls.some(([s]) => s.includes('used_count=used_count+1'))).toBe(true);
  });

  it("rejects another dealer's or a missing voucher", async () => {
    const { q } = fakeQ({});
    await expect(reserveVoucher(q, input)).rejects.toThrow('Voucher không còn khả dụng.');
  });

  it('rejects a voucher the farmer already used, without taking a use', async () => {
    const { q, calls } = fakeQ({
      'FROM agrilink_vouchers WHERE id=$1': [row()],
      'SELECT order_id FROM agrilink_voucher_claims': [{ order_id: 'old-order' }],
    });
    await expect(reserveVoucher(q, input)).rejects.toThrow('Bạn đã dùng voucher này.');
    expect(calls.some(([s]) => s.includes('used_count=used_count+1'))).toBe(false);
  });

  it('rejects an order under the minimum', async () => {
    const { q } = fakeQ({
      'FROM agrilink_vouchers WHERE id=$1': [row()],
      'SELECT order_id FROM agrilink_voucher_claims': [{ order_id: null }],
    });
    const err = await reserveVoucher(q, { ...input, subtotal: 900000 }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Đơn tối thiểu 1.000.000 đ.');
  });
});

describe('linkVoucherClaim / releaseVoucher', () => {
  it('marks the claim as used by the new order', async () => {
    const { q, calls } = fakeQ({});
    await linkVoucherClaim(q, 'v-1', 'farmer-1', 'order-1');
    expect(calls[0][0]).toContain('SET order_id=$3,used_at=now()');
    expect(calls[0][1]).toEqual(['v-1', 'farmer-1', 'order-1']);
  });

  it('gives the use back once when a voucher order is cancelled', async () => {
    const { q, calls } = fakeQ({ 'SET order_id=NULL': [{ voucher_id: 'v-1' }] });
    await releaseVoucher(q, { id: 'order-1', voucherId: 'v-1' });
    expect(calls[0][0]).toContain('FROM agrilink_vouchers WHERE id=$1 FOR UPDATE');
    expect(calls[1][1]).toEqual(['v-1', 'order-1']);
    expect(calls[2][0]).toContain('used_count=GREATEST(used_count-1,0)');
  });

  it('does nothing when the claim was already released or there is no voucher', async () => {
    const { q, calls } = fakeQ({});
    await releaseVoucher(q, { id: 'order-1', voucherId: 'v-1' });
    expect(calls).toHaveLength(2);
    expect(calls.some(([s]) => s.includes('used_count=GREATEST'))).toBe(false);
    await releaseVoucher(q, { id: 'order-2', voucherId: null });
    expect(calls).toHaveLength(2);
  });
});
