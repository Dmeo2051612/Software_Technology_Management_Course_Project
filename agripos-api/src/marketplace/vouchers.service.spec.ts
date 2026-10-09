import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VouchersService } from './vouchers.service';

const owner = { id: 'owner-1', role: 'owner', memberships: [{ id: 'org-1' }], organizationId: 'org-1', suspended: false } as any;
const cashier = { ...owner, role: 'cashier' };
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

const day = 86400000;
const row = (over: Record<string, unknown> = {}) => ({
  id: 'v-1',
  organization_id: 'org-1',
  title: 'Giảm 20K đơn từ 500K',
  discount_type: 'amount',
  value: '20000',
  max_discount: null,
  min_order: '500000',
  quantity: 100,
  used_count: 0,
  starts_at: new Date(Date.now() - day),
  ends_at: new Date(Date.now() + 10 * day),
  active: true,
  created_at: new Date(),
  ...over,
});
const input = {
  title: 'Giảm 20K đơn từ 500K',
  type: 'amount' as const,
  value: 20000,
  minOrder: 500000,
  quantity: 100,
  startsAt: new Date(Date.now() - 60000).toISOString(),
  endsAt: new Date(Date.now() + 10 * day).toISOString(),
};

describe('VouchersService (dealer)', () => {
  it('lists vouchers with their state, saves and 30-day stats', async () => {
    const { db } = fakeDb({
      'FROM agrilink_vouchers v': [
        { ...row(), saved_count: 86, has_orders: true },
        { ...row({ id: 'v-2', used_count: 100 }), saved_count: 3 },
        { ...row({ id: 'v-3', starts_at: new Date(Date.now() + 2 * day) }), saved_count: 0 },
      ],
      'FROM agrilink_orders': [{ used: 47, discounted: 1260000 }],
    });
    const res = await new VouchersService(db).list(owner);
    expect(res.stats).toEqual({ running: 1, used30d: 47, discount30d: 1260000 });
    expect(res.items.map((v) => v.state)).toEqual(['running', 'exhausted', 'scheduled']);
    expect(res.items[0]).toMatchObject({ id: 'v-1', type: 'amount', value: 20000, minOrder: 500000, usedCount: 0, savedCount: 86, hasOrders: true });
    expect(res.items[1].hasOrders).toBe(false);
  });

  it('only lets owners and managers manage vouchers', async () => {
    const { db } = fakeDb({});
    await expect(new VouchersService(db).list(cashier)).rejects.toThrow(ForbiddenException);
    await expect(new VouchersService(db).create(farmer, input)).rejects.toThrow(ForbiddenException);
  });

  it('creates a validated voucher for the own dealer', async () => {
    const { db, calls } = fakeDb({ 'INSERT INTO agrilink_vouchers': [row()] });
    const res = await new VouchersService(db).create(owner, { ...input, title: '  Giảm 20K đơn từ 500K ' });
    const [, params] = calls.find(([s]) => s.includes('INSERT INTO agrilink_vouchers'))!;
    expect(params.slice(0, 8)).toEqual(['org-1', 'Giảm 20K đơn từ 500K', 'amount', 20000, null, 500000, 100, expect.any(Date)]);
    expect(params[10]).toBe('owner-1');
    expect(res).toMatchObject({ id: 'v-1', state: 'running' });
  });

  it('updates under lock and keeps the rules of a used voucher', async () => {
    const { db, calls } = fakeDb({
      'FOR UPDATE': [row({ used_count: 5 })],
      'UPDATE agrilink_vouchers SET': [row({ used_count: 5, quantity: 50 })],
    });
    const svc = new VouchersService(db);
    await svc.update(owner, 'v-1', { quantity: 50 });
    expect(calls[0][1]).toEqual(['v-1', 'org-1']);
    await expect(svc.update(owner, 'v-1', { value: 30000 })).rejects.toThrow('Voucher đã có người dùng');
  });

  it("404s on another dealer's voucher", async () => {
    const { db } = fakeDb({});
    await expect(new VouchersService(db).update(owner, 'v-9', { title: 'x' })).rejects.toThrow(NotFoundException);
    await expect(new VouchersService(db).remove(owner, 'v-9')).rejects.toThrow(NotFoundException);
  });

  it('deletes only a voucher no order ever used', async () => {
    const used = fakeDb({ 'FOR UPDATE': [row()], 'FROM agrilink_orders': [{ used: true }] });
    await expect(new VouchersService(used.db).remove(owner, 'v-1')).rejects.toThrow('hãy dừng voucher thay vì xoá');
    const fresh = fakeDb({ 'FOR UPDATE': [row()], 'FROM agrilink_orders': [{ used: false }] });
    await new VouchersService(fresh.db).remove(owner, 'v-1');
    expect(fresh.calls.some(([s, p]) => s.startsWith('DELETE FROM agrilink_vouchers') && p[0] === 'v-1')).toBe(true);
  });
});

describe('VouchersService (farmer)', () => {
  it('saves a running or upcoming voucher once', async () => {
    const { db, calls } = fakeDb({ 'JOIN agrilink_organizations': [{ ...row({ starts_at: new Date(Date.now() + day) }), marketplace_enabled: true }] });
    await expect(new VouchersService(db).save(farmer, 'v-1')).resolves.toEqual({ saved: true });
    const [sql, params] = calls.find(([s]) => s.startsWith('INSERT INTO agrilink_voucher_claims'))!;
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(params).toEqual(['v-1', 'farmer-1', 'org-1']);
  });

  it('refuses an exhausted, hidden or own-dealer voucher', async () => {
    const exhausted = fakeDb({ 'JOIN agrilink_organizations': [{ ...row({ used_count: 100 }), marketplace_enabled: true }] });
    await expect(new VouchersService(exhausted.db).save(farmer, 'v-1')).rejects.toThrow('Voucher đã hết lượt.');
    const hidden = fakeDb({ 'JOIN agrilink_organizations': [{ ...row(), marketplace_enabled: false }] });
    await expect(new VouchersService(hidden.db).save(farmer, 'v-1')).rejects.toThrow(NotFoundException);
    const own = fakeDb({ 'JOIN agrilink_organizations': [{ ...row(), marketplace_enabled: true }] });
    await expect(new VouchersService(own.db).save(owner, 'v-1')).rejects.toThrow(BadRequestException);
  });

  it('shows the storefront vouchers with the farmer saved/used flags', async () => {
    const { db, calls } = fakeDb({
      'FROM agrilink_vouchers v': [{ ...row({ used_count: 32 }), saved: true, used_by_me: false }],
    });
    const list = await new VouchersService(db).forStorefront('org-1', 'farmer-1');
    expect(calls[0][1]).toEqual(['org-1', 'farmer-1']);
    expect(list).toEqual([
      {
        id: 'v-1',
        title: 'Giảm 20K đơn từ 500K',
        type: 'amount',
        value: 20000,
        maxDiscount: null,
        minOrder: 500000,
        startsAt: expect.any(Date),
        endsAt: expect.any(Date),
        remaining: 68,
        saved: true,
        usedByMe: false,
      },
    ]);
  });
});
