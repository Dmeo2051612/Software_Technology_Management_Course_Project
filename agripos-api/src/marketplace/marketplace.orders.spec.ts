import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { BUY_OFFER_STALE_HOURS } from './trust-pricing';
import sharp from 'sharp';

jest.mock('sharp', () => jest.fn());
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

const sharpMock = sharp as unknown as jest.Mock;

const viewer = {
  id: 'farmer-1',
  role: 'farmer',
  memberships: [],
  organizationId: null,
  suspended: false,
} as any;

function fakeDb(rows: Record<string, any[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    const key = Object.keys(rows).find((k) => sql.includes(k));
    return Promise.resolve(key ? rows[key] : []);
  });
  const em = { query };
  return {
    db: { query, transaction: (cb: any) => cb(em) } as any,
    calls,
  };
}

const dealerRow = { id: 'org-1', fulfillment_options: ['pickup', 'delivery'] };
const saleOffers = [
  {
    id: 'of-1',
    kind: 'sale',
    product_id: 'p-1',
    name: 'NPK',
    unit: 'bao',
    price: 350000,
    commodity_type: null,
  },
  {
    id: 'of-2',
    kind: 'sale',
    product_id: 'p-2',
    name: 'Urê',
    unit: 'bao',
    price: 420000,
    commodity_type: null,
  },
];

describe('MarketplaceService.placeOrder', () => {
  it('prices from offers, ignores client, writes order + items + event', async () => {
    const { db, calls } = fakeDb({
      'FROM agrilink_organizations': [dealerRow],
      'FROM agrilink_offers': saleOffers,
      'MAX(CAST': [{ max_num: 0 }],
      'INSERT INTO agrilink_orders': [{ id: 'al-1' }],
    });
    const svc = new MarketplaceService(db, { viewer: jest.fn() } as any);
    jest.spyOn(svc, 'myOrder').mockResolvedValue({ id: 'al-1' } as any);
    await svc.placeOrder(viewer, 'org-1', {
      kind: 'buy',
      fulfillment: 'pickup',
      contactName: 'Anh Ba',
      contactPhone: '0901234567',
      items: [
        { offerId: 'of-1', quantity: 2 },
        { offerId: 'of-2', quantity: 1 },
      ],
    });
    const insert = calls.find(([s]) =>
      s.includes('INSERT INTO agrilink_orders'),
    )!;
    expect(insert[1]).toEqual(
      expect.arrayContaining(['org-1', 'farmer-1', 'buy', 1120000]),
    );
    expect(
      calls.filter(([s]) => s.includes('INSERT INTO agrilink_order_items')),
    ).toHaveLength(2);
    expect(
      calls.some(([s]) => s.includes('INSERT INTO agrilink_order_events')),
    ).toBe(true);
  });

  it('rejects sell orders with more than one line', async () => {
    const { db } = fakeDb({ 'FROM agrilink_organizations': [dealerRow] });
    const svc = new MarketplaceService(db, {} as any);
    await expect(
      svc.placeOrder(viewer, 'org-1', {
        kind: 'sell',
        fulfillment: 'at_dealer',
        contactName: 'Anh Ba',
        contactPhone: '0901234567',
        items: [
          { offerId: 'a', quantity: 1 },
          { offerId: 'b', quantity: 1 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an offer of the wrong kind or from another dealer', async () => {
    const { db } = fakeDb({
      'FROM agrilink_organizations': [dealerRow],
      'FROM agrilink_offers': [saleOffers[0]],
    });
    const svc = new MarketplaceService(db, {} as any);
    await expect(
      svc.placeOrder(viewer, 'org-1', {
        kind: 'buy',
        fulfillment: 'pickup',
        contactName: 'Anh Ba',
        contactPhone: '0901234567',
        items: [
          { offerId: 'of-1', quantity: 1 },
          { offerId: 'of-x', quantity: 1 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('places a sell order against a crop-only sầu riêng buy offer', async () => {
    const { db, calls } = fakeDb({
      'FROM agrilink_organizations': [dealerRow],
      'FROM agrilink_offers': [{
        id: 'durian-buy-of', kind: 'buy', product_id: null,
        commodity_type: null, crop_id: 'durian-crop', name: 'Sầu riêng',
        unit: 'kg', price: 60000,
      }],
      'MAX(CAST': [{ max_num: 0 }],
      'INSERT INTO agrilink_orders': [{ id: 'al-durian' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    jest.spyOn(svc, 'myOrder').mockResolvedValue({ id: 'al-durian' } as any);
    await expect(svc.placeOrder(viewer, 'org-1', {
        kind: 'sell',
        fulfillment: 'at_dealer',
        contactName: 'Anh Ba',
        contactPhone: '0901234567',
        items: [{ offerId: 'durian-buy-of', quantity: 1 }],
      })).resolves.toEqual({ id: 'al-durian' });
    const offerQuery = calls.find(([s]) => s.includes('FROM agrilink_offers'))!;
    expect(offerQuery[0]).toContain(
      "(f.kind='sale' OR f.commodity_type IS NOT NULL OR f.crop_id IS NOT NULL)",
    );
    expect(offerQuery[0]).toContain("f.price_updated_at <= now()-make_interval(hours => $3)");
    expect(offerQuery[1]).toEqual([['durian-buy-of'], 'org-1', BUY_OFFER_STALE_HOURS]);
    expect(calls.find(([s]) => s.includes('INSERT INTO agrilink_order_items'))![1])
      .toEqual(expect.arrayContaining(['durian-crop', 'Sầu riêng']));
  });

  it('rejects an order whose computed total exceeds the money bound', async () => {
    const hugeOffer = [
      {
        id: 'of-huge',
        kind: 'sale',
        product_id: 'p-1',
        name: 'NPK',
        unit: 'bao',
        price: 9999999999999,
        commodity_type: null,
      },
    ];
    const { db } = fakeDb({
      'FROM agrilink_organizations': [dealerRow],
      'FROM agrilink_offers': hugeOffer,
    });
    const svc = new MarketplaceService(db, {} as any);
    await expect(
      svc.placeOrder(viewer, 'org-1', {
        kind: 'buy',
        fulfillment: 'pickup',
        contactName: 'Anh Ba',
        contactPhone: '0901234567',
        items: [{ offerId: 'of-huge', quantity: 2 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('MarketplaceService.placeOrderTx', () => {
  it('locks a supply delivery slot in placeOrderTx without a delivery fulfillment option', async () => {
    const { db, calls } = fakeDb({
      'FROM agrilink_organizations': [{ ...dealerRow, fulfillment_options: ['pickup'] }],
      'FROM agrilink_offers': [saleOffers[0]],
      'FROM agrilink_dealer_services': [{ id: 'service-1', lead_time_hours: 0 }],
      'FROM agrilink_service_windows': [{ capacity: 1, used: 0 }],
      'MAX(CAST': [{ max_num: 0 }],
      'INSERT INTO agrilink_orders': [{ id: 'al-delivery' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    const id = await svc.placeOrderTx({ query: db.query } as any, viewer, 'org-1', {
      kind: 'buy', fulfillment: 'delivery', address: 'Đắk Lắk',
      contactName: 'Anh Ba', contactPhone: '0901234567',
      items: [{ offerId: 'of-1', quantity: 1 }],
    }, { scheduledDate: '2026-10-05', scheduledSession: 'afternoon' });
    expect(id).toBe('al-delivery');
    expect(calls.filter(([sql]) => sql.includes('FROM agrilink_dealer_services') && sql.includes('FOR UPDATE'))).toHaveLength(1);
    expect(calls).toContainEqual([
      expect.stringContaining('INSERT INTO agrilink_service_bookings'),
      ['service-1', 'org-1', '2026-10-05', 'afternoon', 'al-delivery'],
    ]);
  });

});

describe('MarketplaceService.dealer/dealers', () => {
  it('lists and counts crop-only buy offers as orderable', async () => {
    const cropOnlyOffer = {
      id: 'durian-buy-of',
      title: 'Sầu riêng',
      cropId: 'durian-crop',
      commodityType: null,
      orderable: true,
      priceUpdatedAt: new Date(),
    };
    const { db, calls } = fakeDb({
      'FROM agrilink_organizations o LEFT JOIN admin_provinces': [dealerRow],
      'FROM agrilink_offers f': [{ offerId: 'durian-buy-of', cropId: 'durian-crop', commodityType: null, priceUpdatedAt: new Date() }],
      'LEFT JOIN agrilink_offers f ON f.organization_id=o.id': [
        { id: 'org-1', buyCount: 1 },
      ],
      "FROM agrilink_offers WHERE organization_id=$1 AND kind='buy'": [
        cropOnlyOffer,
      ],
    });
    const svc = new MarketplaceService(db, {} as any);
    const storefront = await svc.dealer('org-1');
    const directory = await svc.dealers();
    const managed = await svc.buyOffers({
      ...viewer,
      role: 'manager',
      organizationId: 'org-1',
      memberships: [{ id: 'org-1' }],
    });
    expect(storefront.buyOffers).toEqual([{ offerId: 'durian-buy-of', cropId: 'durian-crop', commodityType: null, priceUpdatedAt: expect.any(Date), priceFreshness: 'today', market: null }]);
    expect(directory[0].buyCount).toBe(1);
    expect(managed).toEqual([{ ...cropOnlyOffer, stale: false, priceAgeHours: expect.any(Number), market: null }]);
    const buyOffersQuery = calls.find(([s]) =>
      s.includes("f.kind='buy' AND f.active"),
    )!;
    expect(buyOffersQuery[0]).toContain("f.kind='buy' AND f.active AND f.price_updated_at > now()-make_interval(hours => $2) AND (f.commodity_type IS NOT NULL OR f.crop_id IS NOT NULL)");
    expect(buyOffersQuery[1]).toEqual(['org-1', BUY_OFFER_STALE_HOURS]);
    const dealersQuery = calls.find(([s]) => s.includes('"buyCount"'))!;
    expect(dealersQuery[0]).toContain(
      "f.kind='buy' AND f.active AND f.price_updated_at > now()-make_interval(hours => $2) AND (f.commodity_type IS NOT NULL OR f.crop_id IS NOT NULL)",
    );
    expect(dealersQuery[1]).toEqual(['', BUY_OFFER_STALE_HOURS, '', '']);
    const manageQuery = calls.find(([s]) =>
      s.includes("FROM agrilink_offers WHERE organization_id=$1 AND kind='buy'"),
    )!;
    expect(manageQuery[0]).toContain('(commodity_type IS NOT NULL OR crop_id IS NOT NULL) AS "orderable"');
    expect(manageQuery[0]).toContain("kind='buy' ORDER BY active DESC");
  });

  it('tags dealers with the crops of their fresh buy offers and filters by crop code', async () => {
    const { db, calls } = fakeDb({
      'LEFT JOIN agrilink_offers f ON f.organization_id=o.id': [
        { id: 'org-1', crops: [{ code: 'ho-tieu', name: 'Hồ tiêu' }] },
      ],
    });
    const svc = new MarketplaceService(db, {} as any);
    const directory = await svc.dealers(' An Phú ', ' ho-tieu ');
    expect(directory[0].crops).toEqual([{ code: 'ho-tieu', name: 'Hồ tiêu' }]);
    const [sql, params] = calls.find(([s]) => s.includes('"buyCount"'))!;
    expect(params).toEqual(['An Phú', BUY_OFFER_STALE_HOURS, 'ho-tieu', '']);
    // Nhãn chỉ lấy từ tin thu mua đang mở và còn mới giá (cùng điều kiện với buyCount).
    expect(sql).toContain('AS crops');
    expect(sql).toContain("bf.kind='buy' AND bf.active AND bf.price_updated_at > now()-make_interval(hours => $2)");
    expect(sql).toContain('(c.id=bf.crop_id OR (bf.crop_id IS NULL AND c.commodity_type=bf.commodity_type))');
    // Lọc theo nông sản: đại lý phải có ít nhất một tin thu mua còn mới cho nông sản đó.
    expect(sql).toContain("($3='' OR EXISTS(");
  });

  it('searches without diacritics across name, region, address and province, and filters by province', async () => {
    const { db, calls } = fakeDb({ 'LEFT JOIN agrilink_offers f ON f.organization_id=o.id': [] });
    const svc = new MarketplaceService(db, {} as any);
    await svc.dealers('can tho', '', ' can-tho ');
    const [sql, params] = calls.find(([s]) => s.includes('"buyCount"'))!;
    expect(sql).toContain("unaccent(concat_ws(' ',o.name,o.region,o.address,p.name)) ILIKE unaccent('%'||$1||'%')");
    expect(sql).toContain("($4='' OR o.province_code=$4)");
    expect(params).toEqual(['can tho', BUY_OFFER_STALE_HOURS, '', 'can-tho']);
  });
});

describe('MarketplaceService.myOrder', () => {
  it('resolves posRef to {type,id,code,status} from the POS order, scoped by the order org', async () => {
    const { db, calls } = fakeDb({
      'JOIN agrilink_organizations o ON o.id=a."organizationId"': [
        {
          id: 'al-1',
          code: 'AL-1',
          kind: 'buy',
          status: 'completed',
          organizationId: 'org-1',
          posRefType: 'order',
          posRefId: 'pos-1',
        },
      ],
      'FROM agrilink_order_items WHERE "orderId"': [],
      'FROM agrilink_order_events WHERE "orderId"': [],
      'FROM orders WHERE id': [{ code: 'DH-001', status: 'completed' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    const result = await svc.myOrder(viewer, 'al-1');
    expect(result.posRef).toEqual({
      type: 'order',
      id: 'pos-1',
      code: 'DH-001',
      status: 'completed',
    });
    expect(result).not.toHaveProperty('organizationId');
    expect(result).not.toHaveProperty('posRefType');
    expect(result).not.toHaveProperty('posRefId');
    const posQuery = calls.find(([s]) => s.includes('FROM orders WHERE id'))!;
    expect(posQuery[1]).toEqual(['pos-1', 'org-1']);
  });

  it('resolves posRef from the weighing slip for sell orders', async () => {
    const { db } = fakeDb({
      'JOIN agrilink_organizations o ON o.id=a."organizationId"': [
        {
          id: 'al-2',
          code: 'AL-2',
          kind: 'sell',
          status: 'completed',
          organizationId: 'org-1',
          posRefType: 'weighing_slip',
          posRefId: 'slip-1',
        },
      ],
      'FROM agrilink_order_items WHERE "orderId"': [],
      'FROM agrilink_order_events WHERE "orderId"': [],
      'FROM weighing_slips WHERE id': [{ code: 'CT-001', status: 'unpaid' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    const result = await svc.myOrder(viewer, 'al-2');
    expect(result.posRef).toEqual({
      type: 'weighing_slip',
      id: 'slip-1',
      code: 'CT-001',
      status: 'unpaid',
    });
  });
});

describe('MarketplaceService.cancelMyOrder', () => {
  it('releases a booking and reopens its intent after buyer cancellation', async () => {
    const { db, calls } = fakeDb({
      'FOR UPDATE': [{ id: 'al-1', status: 'pending', fulfillment: 'delivery', organizationId: 'org-1', intentId: 'intent-1' }],
      'FROM users': [{ fullName: 'Anh Ba' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    jest.spyOn(svc, 'myOrder').mockResolvedValue({ id: 'al-1', status: 'cancelled' } as any);
    await svc.cancelMyOrder(viewer, 'al-1');
    expect(calls).toEqual(expect.arrayContaining([
      [expect.stringContaining("UPDATE agrilink_service_bookings SET status='cancelled'"), ['al-1']],
      [expect.stringContaining("UPDATE agrilink_intents SET status=CASE WHEN window_end"), ['intent-1']],
      [expect.stringContaining("UPDATE agrilink_intent_offers SET status='expired'"), ['intent-1']],
    ]));
  });

  it('refuses when the order is delivering', async () => {
    const { db } = fakeDb({
      'FOR UPDATE': [
        {
          id: 'al-1',
          status: 'delivering',
          fulfillment: 'delivery',
          organizationId: 'org-1',
        },
      ],
    });
    const svc = new MarketplaceService(db, {} as any);
    await expect(svc.cancelMyOrder(viewer, 'al-1')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('storefront management', () => {
  const manager = {
    id: 'u-m',
    role: 'manager',
    organizationId: 'org-1',
    memberships: [{ id: 'org-1' }],
  } as any;
  const cashier = { ...manager, role: 'cashier' };

  it.each(['owner', 'manager'] as const)('lets a %s confirm a buy offer in their organization', async (role) => {
    const refreshedAt = new Date();
    const { db, calls } = fakeDb({
      'UPDATE agrilink_offers SET price_updated_at': [{ id: 'bo-1', priceUpdatedAt: refreshedAt }],
    });
    const result = await new MarketplaceService(db, {} as any).confirmBuyOffer(
      { ...manager, role }, 'bo-1',
    );
    expect(result).toMatchObject({ id: 'bo-1', priceUpdatedAt: refreshedAt });
    const [sql, params] = calls[0];
    expect(sql).toContain('SET price_updated_at=now(),updated_at=now()');
    expect(sql).toContain("WHERE id=$1 AND organization_id=$2 AND kind='buy'");
    expect(params).toEqual(['bo-1', 'org-1']);
  });

  it('returns 404 when confirming a foreign or missing buy offer', async () => {
    const { db, calls } = fakeDb({});
    await expect(new MarketplaceService(db, {} as any).confirmBuyOffer(manager, 'foreign-bo'))
      .rejects.toThrow(NotFoundException);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(['foreign-bo', 'org-1']);
  });

  it.each(['owner', 'manager'] as const)('lets a %s confirm all active buy offers in their organization', async (role) => {
    const { db, calls } = fakeDb({
      'UPDATE agrilink_offers SET price_updated_at': [{ id: 'bo-1' }, { id: 'bo-2' }],
    });
    await expect(new MarketplaceService(db, {} as any).confirmAllBuyOffers({ ...manager, role }))
      .resolves.toEqual({ count: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('SET price_updated_at=now(),updated_at=now()');
    expect(calls[0][0]).toContain("WHERE organization_id=$1 AND kind='buy' AND active");
    expect(calls[0][1]).toEqual(['org-1']);
  });

  it('allows only owners and managers to confirm buy offer prices', async () => {
    const { db, calls } = fakeDb({});
    const svc = new MarketplaceService(db, {} as any);
    await expect(svc.confirmBuyOffer(cashier, 'bo-1')).rejects.toThrow(ForbiddenException);
    await expect(svc.confirmAllBuyOffers(cashier)).rejects.toThrow(ForbiddenException);
    expect(calls).toHaveLength(0);
  });

  it('lets a manager (not only owner) update the profile', async () => {
    const { db, calls } = fakeDb({
      'FROM agrilink_organizations': [{ id: 'org-1', name: 'Đại lý A' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    await svc.updateProfile(manager, {
      openingHours: '7:00-18:00',
      fulfillmentOptions: ['pickup'],
      marketplaceEnabled: false,
    });
    const upd = calls.find(([s]) =>
      s.startsWith('UPDATE agrilink_organizations'),
    )!;
    expect(upd[1]).toEqual(
      expect.arrayContaining(['org-1', '7:00-18:00', ['pickup'], false]),
    );
  });

  it('forbids cashiers', async () => {
    const svc = new MarketplaceService(fakeDb({}).db, {} as any);
    await expect(svc.profile(cashier)).rejects.toThrow(ForbiddenException);
  });

  it('stores an AgriLink price override or null for POS price', async () => {
    const { db, calls } = fakeDb({ 'FROM products': [{ id: 'p-1' }] });
    const svc = new MarketplaceService(db, {} as any);
    jest.spyOn(svc as any, 'productRow').mockResolvedValue({});
    await svc.setProduct(manager, 'p-1', { published: true, price: null });
    const up = calls.find(([s]) => s.includes('INSERT INTO agrilink_offers'))!;
    expect(up[1]).toEqual(['org-1', 'p-1', true, null]);
  });

  it('requires a file to upload a logo', async () => {
    const svc = new MarketplaceService(fakeDb({}).db, {} as any);
    await expect(svc.uploadLogo(manager, undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an invalid image buffer without updating the organization', async () => {
    const { db, calls } = fakeDb({});
    const svc = new MarketplaceService(db, {} as any);
    const chain = {
      rotate: () => chain,
      resize: () => chain,
      webp: () => chain,
      toFile: jest.fn().mockRejectedValue(new Error('unsupported image')),
    };
    sharpMock.mockReturnValue(chain);
    const file = { buffer: Buffer.from('not an image') } as any;
    await expect(svc.uploadLogo(manager, file)).rejects.toThrow(
      BadRequestException,
    );
    expect(
      calls.some(([s]) => s.startsWith('UPDATE agrilink_organizations')),
    ).toBe(false);
  });

  it('requires a file to upload a cover image', async () => {
    const svc = new MarketplaceService(fakeDb({}).db, {} as any);
    await expect(svc.uploadCover(manager, undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('stores an uploaded cover as a 1600x600 webp on the manager organization', async () => {
    const { db, calls } = fakeDb({});
    const svc = new MarketplaceService(db, {} as any);
    const resize = jest.fn();
    const chain = {
      rotate: () => chain,
      resize: (...a: unknown[]) => (resize(...a), chain),
      webp: () => chain,
      toFile: jest.fn().mockResolvedValue({}),
    };
    sharpMock.mockReturnValue(chain);
    const result = await svc.uploadCover(manager, { buffer: Buffer.from('img') } as any);
    expect(resize).toHaveBeenCalledWith(1600, 600, expect.objectContaining({ fit: 'cover' }));
    expect(result.coverUrl).toMatch(/^\/uploads\/covers\/org-1-\d+\.webp$/);
    const up = calls.find(([s]) => s.includes('SET cover_url'))!;
    expect(up[1]).toEqual(['org-1', result.coverUrl]);
  });

  it('passes commodityType into the buy offer INSERT params', async () => {
    const { db, calls } = fakeDb({
      'INSERT INTO agrilink_offers': [{ id: 'bo-1' }],
    });
    const svc = new MarketplaceService(db, {} as any);
    await svc.addBuyOffer(manager, {
      title: 'Cà phê tươi',
      commodityType: 'coffee_fresh',
      unit: 'kg',
      price: 12000,
    });
    const ins = calls.find(([s]) => s.includes('INSERT INTO agrilink_offers'))!;
    expect(ins[1]).toEqual([
      'org-1',
      'Cà phê tươi',
      'coffee_fresh',
      'kg',
      12000,
      null,
      null,
      null,
    ]);
  });

  it('throws NotFoundException updating a buy offer that is missing or belongs to another dealer', async () => {
    const { db } = fakeDb({});
    const svc = new MarketplaceService(db, {} as any);
    await expect(
      svc.updateBuyOffer(manager, 'bo-x', { active: false }),
    ).rejects.toThrow(NotFoundException);
  });

  it('coerces published=false and applies default paging to listProducts', async () => {
    const { db, calls } = fakeDb({
      'AS "productId"': [],
      'count(*)::int AS total': [{ total: 0 }],
    });
    const svc = new MarketplaceService(db, {} as any);
    await svc.listProducts(manager, { published: 'false' } as any);
    const sel = calls.find(([s]) => s.includes('AS "productId"'))!;
    expect(sel[1]).toEqual(['org-1', '', false]);
    expect(sel[0]).toContain('LIMIT 50 OFFSET 0');
  });
});
