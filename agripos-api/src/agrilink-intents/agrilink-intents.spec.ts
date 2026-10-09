import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AgrilinkIntentsService } from './agrilink-intents.service';
import { BUY_OFFER_STALE_HOURS } from '../marketplace/trust-pricing';
import { CreateIntentDto, ParseIntentDto } from './dto';

describe('intents API contracts', () => {
  it('validates parse and create DTO fields', () => {
    expect(
      validateSync(plainToInstance(ParseIntentDto, { text: '' })).length,
    ).toBeGreaterThan(0);
    const dto = plainToInstance(CreateIntentDto, {
      rawText: 'bán cà phê',
      side: 'sell',
      provinceCode: 'dak-lak',
      windowStart: '2026-09-28',
      windowEnd: '2026-10-04',
      fulfillmentPref: 'any',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(
      validateSync(
        plainToInstance(CreateIntentDto, { ...dto, windowStart: 'tomorrow' }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it('rejects an unconfirmed sell intent without crop and quantity', async () => {
    const svc = new AgrilinkIntentsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      svc.create({ id: 'farmer' } as any, {
        rawText: 'bán',
        side: 'sell',
        provinceCode: 'dak-lak',
        windowStart: '2026-09-28',
        windowEnd: '2026-10-04',
        fulfillmentPref: 'any',
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it.each(['2026-13-01', '2026-00-10', '2026-01-32'])(
    'rejects the impossible calendar date %s with 400',
    async (windowStart) => {
      const svc = new AgrilinkIntentsService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      const dto = {
        rawText: 'mua phân NPK',
        side: 'buy' as const,
        productQuery: 'phân NPK',
        provinceCode: 'dak-lak',
        windowStart,
        windowEnd: '2027-10-04',
        fulfillmentPref: 'any' as const,
      };
      expect(validateSync(plainToInstance(CreateIntentDto, dto))).toEqual([]);
      await expect(
        svc.create({ id: 'farmer' } as any, dto),
      ).rejects.toMatchObject({
        status: 400,
        response: { message: 'Ngày không hợp lệ.' },
      });
    },
  );
  it('returns anonymised dealer leads', async () => {
    const db = { query: jest.fn(async () => [{ id: 'intent-1' }]) };
    const svc = new AgrilinkIntentsService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (svc as any).row = async () => ({
      id: 'intent-1',
      requesterId: 'secret-user',
      side: 'sell',
      cropId: 'crop',
      cropName: 'Cà phê nhân',
      productQuery: null,
      quantityKg: 5000,
      quantityText: '5 tấn',
      provinceName: 'Đắk Lắk',
      communeName: null,
      windowStart: '2026-09-28',
      windowEnd: '2026-10-04',
      expectedPricePerKg: null,
      fulfillmentPref: 'pickup',
      createdAt: new Date(),
    });
    svc.matches = async () =>
      [
        { dealer: { id: 'org', name: 'Dealer' }, distanceKm: 10, score: 90 },
      ] as any;
    const leads = await svc.leads(
      {
        id: 'viewer',
        role: 'owner',
        organizationId: 'org',
        memberships: [{ id: 'org' }],
      } as any,
      {},
    );
    expect(leads).toHaveLength(1);
    expect(JSON.stringify(leads)).not.toMatch(/secret-user|requesterId|phone/i);
  });
  it('shows the seventh eligible dealer its full-set score', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      id: `org-${index + 1}`,
      name: `Dealer ${index + 1}`,
      logoUrl: null,
      provinceName: 'Đắk Lắk',
      lat: 12.7,
      lng: 108,
      completedOrders: 0,
      offerId: `offer-${index + 1}`,
      price: 170 - index * 10,
      unit: 'kg',
      maxQuantityKg: null,
      priceUpdatedAt: new Date(),
    }));
    const db = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM agrilink_intents WHERE status='))
          return [{ id: 'intent-1' }];
        if (sql.includes('FROM agrilink_organizations')) {
          expect(sql).toContain('ao."completedAt">=now()');
          expect(sql).toContain(
            "f.kind='buy' AND f.active AND f.price_updated_at > now()-make_interval(hours => $5)",
          );
          expect(sql).toContain("AND ($4='buy' OR f.id IS NOT NULL)");
          expect(params).toEqual([
            'farmer',
            'crop',
            '2027-10-01',
            'sell',
            BUY_OFFER_STALE_HOURS,
          ]);
          return rows;
        }
        if (sql.includes('FROM agrilink_dealer_services')) return [];
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };
    const svc = new AgrilinkIntentsService(
      db as any,
      {} as any,
      {} as any,
      { explain: () => [] } as any,
    );
    const intent = {
      id: 'intent-1',
      requesterId: 'farmer',
      side: 'sell',
      cropId: 'crop',
      cropName: 'Cà phê nhân',
      productQuery: null,
      quantityKg: 5000,
      quantityText: '5 tấn',
      provinceCode: 'dak-lak',
      provinceName: 'Đắk Lắk',
      communeName: null,
      windowStart: '2027-10-01',
      windowEnd: '2027-10-04',
      expectedPricePerKg: null,
      fulfillmentPref: 'any',
      lat: 12.7,
      lng: 108,
      createdAt: new Date(),
    };
    (svc as any).row = async () => intent;
    expect(await svc.matches(intent)).toHaveLength(5);
    const leads = await svc.leads(
      {
        id: 'viewer',
        role: 'owner',
        organizationId: 'org-7',
        memberships: [{ id: 'org-7' }],
      } as any,
      {},
    );
    expect(leads).toHaveLength(1);
    expect(leads[0].myScore).toBe(47.35);
  });
  it('preview tính đại lý phù hợp mà không lưu nhu cầu, không báo đại lý', async () => {
    const db = {
      query: jest.fn(async (_sql: string) => [{ lat: 12.7, lng: 108.1 }]),
    };
    const svc = new AgrilinkIntentsService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(svc as any, 'validateIntent').mockResolvedValue(undefined);
    const matches = jest
      .spyOn(svc, 'matches')
      .mockResolvedValue([{ dealer: { id: 'dealer-1' } }] as any);
    const out = await svc.preview({ id: 'farmer' } as any, {
      rawText: 'mua phân NPK',
      side: 'buy',
      productQuery: 'Phân NPK 16-16-8',
      provinceCode: 'dak-lak',
      communeCode: 'ea-tul',
      windowStart: '2026-10-04',
      windowEnd: '2026-10-11',
      fulfillmentPref: 'dropoff',
    });
    expect(out).toEqual({ matches: [{ dealer: { id: 'dealer-1' } }] });
    expect(matches).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterId: 'farmer',
        side: 'buy',
        cropId: null,
        productQuery: 'phan npk 16 16 8',
        lat: 12.7,
        lng: 108.1,
      }),
    );
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).not.toMatch(/INSERT/);
  });
});
