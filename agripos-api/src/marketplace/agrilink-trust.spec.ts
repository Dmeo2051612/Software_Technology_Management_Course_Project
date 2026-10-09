import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AgriReferenceService } from '../agri-reference/agri-reference.service';
import { reliability } from '../agrilink-intents/scoring';
import { TemplateMatchExplainer } from '../agrilink-intents/explainer';
import { AgrilinkTrustService } from './agrilink-trust.service';
import { priceFreshness, stalePrice, vsMarketPct } from './trust-pricing';

const now = new Date('2026-09-28T05:00:00Z');
const owner = {
  id: 'user',
  role: 'owner',
  organizationId: 'org',
  memberships: [{ id: 'org' }],
  platformRole: null,
} as any;

describe('AgriLink trust rules', () => {
  it('expires prices at 48 hours and uses VN calendar days', () => {
    expect(
      stalePrice(new Date(now.getTime() - (48 * 60 - 1) * 60000), now),
    ).toBe(false);
    expect(stalePrice(new Date(now.getTime() - 48 * 3600000), now)).toBe(true);
    expect(priceFreshness(new Date('2026-09-27T17:30:00Z'), now)).toBe('today');
    expect(priceFreshness(new Date('2026-09-27T16:30:00Z'), now)).toBe(
      'yesterday',
    );
  });

  it('blends ratings only after three visible ratings', () => {
    const volume = Math.log1p(10) / Math.log(21);
    expect(reliability(10, 2, 5)).toBeCloseTo(volume);
    expect(reliability(10, 3, 5)).toBeCloseTo(0.6 * volume + 0.4);
    expect(reliability(10, 3, 1)).toBeCloseTo(0.6 * volume);
  });

  it('shows market and rating reasons without changing the score', () => {
    expect(vsMarketPct(128000, { pricePerKg: 126500 })).toBe(1.2);
    const reasons = new TemplateMatchExplainer().explain(
      { side: 'sell', quantityKg: 100 } as any,
      {
        offer: { price: 128000, maxQuantityKg: null },
        effectivePrice: 128000,
        pickup: null,
        distanceKm: null,
        dealer: { verified: true },
        completedOrders: 26,
        reliability: { ratingCount: 26, avgStars: 4.8, accurateWeightPct: 98 },
        market: {
          pricePerKg: 126500,
          scope: 'province',
          provinceName: 'Đắk Lắk',
        },
        vsMarketPct: 1.2,
      } as any,
    );
    expect(reasons).toContain(
      'Cao hơn giá thị trường Đắk Lắk hôm nay 1,2% (126.500đ/kg)',
    );
    expect(reasons).toContain('4,8★ từ 26 đánh giá · 98% cân đúng');
    expect(reasons).toContain('Đại lý đã xác minh giấy phép kinh doanh');
  });

  it('selects province prices, then regional average, then null', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        provinceCode: 'dak-lak',
        provinceName: 'Đắk Lắk',
        price: 100,
        recordedAt: '2026-09-28',
        source: 'a',
      },
      {
        provinceCode: 'lam-dong',
        provinceName: 'Lâm Đồng',
        price: 200,
        recordedAt: '2026-09-27',
        source: 'b',
      },
    ]);
    const service = new AgriReferenceService({ query } as any);
    expect((await service.marketPrice('crop', 'dak-lak'))?.pricePerKg).toBe(
      100,
    );
    expect((await service.marketPrice('crop', 'gia-lai'))?.pricePerKg).toBe(
      150,
    );
    expect(query.mock.calls[0][0]).toContain(
      "recorded_at >= ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 3)",
    );
    query.mockResolvedValue([]);
    expect(await service.marketPrice('other', 'dak-lak')).toBeNull();
  });

  it('restricts ratings to completed requester orders and applicable tags', async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes('FROM agrilink_orders')
        ? [
            {
              id: 'order',
              org: 'org',
              kind: 'sell',
              status: 'completed',
              completed: now,
            },
          ]
        : [],
    );
    const service = new AgrilinkTrustService(
      { query, transaction: (cb: any) => cb({ query }) } as any,
      {} as any,
    );
    await expect(
      service.rate(owner, 'order', { stars: 5, asDescribed: true }),
    ).rejects.toThrow(BadRequestException);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO agrilink_order_ratings'),
      ),
    ).toBe(false);
    query.mockImplementation(async (sql: string) =>
      sql.includes('FROM agrilink_orders') ? [] : [],
    );
    await expect(service.rate(owner, 'order', { stars: 5 })).rejects.toThrow();
  });

  it('restricts verification to owner and validates tax codes', async () => {
    const service = new AgrilinkTrustService(
      { query: jest.fn() } as any,
      {
        admin: (v: any) => {
          if (v.platformRole !== 'admin') throw new ForbiddenException();
        },
      } as any,
    );
    await expect(
      service.submit(
        { ...owner, role: 'manager' },
        { legalName: 'A', taxCode: '0123456789', businessAddress: 'B' },
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.submit(owner, {
        legalName: 'A',
        taxCode: 'bad',
        businessAddress: 'B',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(service.verifications(owner)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('reminds only active offers between 36 and 48 hours with a daily dedupe key', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new AgrilinkTrustService({ query } as any, {} as any);
    await service.remindPrices();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("f.kind='buy' AND f.active");
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).toContain("'agrilink-price:' || f.id || ':' || $1");
    expect(params.slice(1)).toEqual([36, 48]);
  });

  it('rejects a second rating through the unique order constraint', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM agrilink_orders'))
        return [
          {
            id: 'order',
            org: 'org',
            kind: 'buy',
            status: 'completed',
            completed: new Date(),
          },
        ];
      if (sql.includes('INSERT INTO agrilink_order_ratings'))
        throw { code: '23505' };
      return [];
    });
    const service = new AgrilinkTrustService(
      { transaction: (cb: any) => cb({ query }) } as any,
      {} as any,
    );
    await expect(
      service.rate(owner, 'order', { stars: 4, asDescribed: true }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows only an admin to decide a pending verification', async () => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('UPDATE agrilink_dealer_verifications')
        ? [{ organization_id: 'org', status: 'verified' }]
        : [],
    );
    const community = {
      admin: (v: any) => {
        if (v.platformRole !== 'admin') throw new ForbiddenException();
      },
    };
    const service = new AgrilinkTrustService(
      { query } as any,
      community as any,
    );
    await expect(service.decide(owner, 'org', 'approve')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.decide({ ...owner, platformRole: 'admin' }, 'org', 'revoke'),
    ).rejects.toThrow(BadRequestException);
    await service.decide({ ...owner, platformRole: 'admin' }, 'org', 'approve');
    expect(query.mock.calls[0][1]!.slice(1, 3)).toEqual([
      'pending',
      'verified',
    ]);
  });
});
