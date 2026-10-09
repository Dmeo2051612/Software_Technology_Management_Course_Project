import { BadRequestException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { DealerServiceDto } from './dealer-services.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const manager = {
  role: 'manager',
  organizationId: 'org-1',
  memberships: [{ id: 'org-1' }],
} as any;

function fakeDb(rows: Record<string, any[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    const key = Object.keys(rows).find((part) => sql.includes(part));
    return Promise.resolve(key ? rows[key] : []);
  });
  return {
    db: { query, transaction: (cb: any) => cb({ query }) } as any,
    calls,
  };
}

describe('dealer matching data', () => {
  const base = {
    active: true,
    cropIds: [],
    areaMode: 'radius' as const,
    radiusKm: 30,
    provinceCodes: [],
    feeMode: 'free' as const,
    feeAmount: 0,
    minQuantityKg: 0,
    leadTimeHours: 12,
    note: '',
    windows: [{ weekday: 1, session: 'morning' as const, capacity: 5 }],
  };

  it('validates service DTO bounds and nested session fields', async () => {
    const dto = plainToInstance(DealerServiceDto, {
      ...base,
      radiusKm: 301,
      windows: [{ weekday: 7, session: 'evening', capacity: 0 }],
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['radiusKm', 'windows']),
    );
  });

  it('requires coordinates for radius mode', async () => {
    const { db } = fakeDb({
      'FROM agrilink_effective_coords': [{ lat: null, lng: null }],
    });
    await expect(
      new MarketplaceService(db, {} as any).putService(
        manager,
        'farm_pickup',
        base,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires a province for province mode', async () => {
    const { db } = fakeDb({});
    await expect(
      new MarketplaceService(db, {} as any).putService(
        manager,
        'supply_delivery',
        {
          ...base,
          areaMode: 'provinces',
          radiusKm: null,
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires zero fee in free mode and unique windows', async () => {
    const { db } = fakeDb({});
    const service = new MarketplaceService(db, {} as any);
    await expect(
      service.putService(manager, 'farm_pickup', { ...base, feeAmount: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.putService(manager, 'farm_pickup', {
        ...base,
        windows: [base.windows[0], base.windows[0]],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('replaces all session windows in one service transaction', async () => {
    const { db, calls } = fakeDb({
      'SELECT code FROM admin_provinces WHERE code=ANY': [{ code: 'dak-lak' }],
      'INSERT INTO agrilink_dealer_services': [{ id: 'service-1' }],
      'FROM agrilink_dealer_services s': [
        { kind: 'farm_pickup', windows: base.windows },
      ],
    });
    const service = new MarketplaceService(db, {} as any);
    const result = await service.putService(manager, 'farm_pickup', {
      ...base,
      areaMode: 'provinces',
      radiusKm: null,
      provinceCodes: ['dak-lak'],
    });
    expect(result.kind).toBe('farm_pickup');
    expect(
      calls.some(([sql]) =>
        sql.includes('DELETE FROM agrilink_service_windows'),
      ),
    ).toBe(true);
    expect(
      calls.filter(([sql]) =>
        sql.includes('INSERT INTO agrilink_service_windows'),
      ),
    ).toHaveLength(1);
  });

  it('derives commodity type from cropId for a buy offer', async () => {
    const { db, calls } = fakeDb({
      'FROM agri_crops': [{ commodity_type: 'coffee_bean' }],
      'INSERT INTO agrilink_offers': [{ id: 'offer-1' }],
    });
    await new MarketplaceService(db, {} as any).addBuyOffer(manager, {
      title: 'Cà phê nhân',
      cropId: 'crop-1',
      commodityType: 'pepper',
      unit: 'kg',
      price: 50000,
    });
    const insert = calls.find(([sql]) =>
      sql.includes('INSERT INTO agrilink_offers'),
    )!;
    expect(insert[1]).toEqual(
      expect.arrayContaining(['crop-1', 'coffee_bean']),
    );
  });

  it('replaces a legacy commodity with the selected crop on update', async () => {
    const { db, calls } = fakeDb({
      'FROM agri_crops': [{ commodity_type: null }],
      'UPDATE agrilink_offers': [{ id: 'offer-1' }],
    });
    await new MarketplaceService(db, {} as any).updateBuyOffer(
      manager,
      'offer-1',
      {
        cropId: 'crop-2',
        commodityType: 'pepper',
      },
    );
    const update = calls.find(([sql]) =>
      sql.includes('UPDATE agrilink_offers'),
    )!;
    expect(update[1][6]).toBe('crop-2');
    expect(update[1][7]).toBeNull();
  });

  it('rejects a commune outside the chosen province', async () => {
    const { db } = fakeDb({
      'FROM agrilink_organizations': [
        { province_code: null, commune_code: null, lat: null, lng: null },
      ],
      'FROM admin_provinces': [{ code: 'dak-lak' }],
      'FROM admin_communes': [{ province_code: 'lam-dong' }],
    });
    await expect(
      new MarketplaceService(db, {} as any).updateProfile(manager, {
        provinceCode: 'dak-lak',
        communeCode: 'xa-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires dealer coordinates to be supplied or cleared as a pair', async () => {
    const { db } = fakeDb({});
    await expect(
      new MarketplaceService(db, {} as any).updateProfile(manager, {
        lat: 12.6,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
