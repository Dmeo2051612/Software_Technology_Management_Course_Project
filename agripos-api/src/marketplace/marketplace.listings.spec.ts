import { BadRequestException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { saleOfferSql } from './sale-offer-sql';
import sharp from 'sharp';

jest.mock('sharp', () => jest.fn());
jest.mock('node:fs/promises', () => ({ mkdir: jest.fn().mockResolvedValue(undefined) }));

const owner = {
  id: 'owner-1',
  role: 'owner',
  memberships: [{ id: 'org-1' }],
  organizationId: 'org-1',
  suspended: false,
} as any;

function fakeDb(rows: Record<string, any[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    const key = Object.keys(rows).find((k) => sql.includes(k));
    return Promise.resolve(key ? rows[key] : []);
  });
  return { db: { query, transaction: (cb: any) => cb({ query }) } as any, calls };
}

const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
const productLookup = {
  'FROM products WHERE id=$1': [{ id: 'p-1', sellingPrice: 450000 }],
  'AS "currentPrice"': [{ currentPrice: null }],
};
const updateCall = (calls: Array<[string, unknown[]]>) => calls.find(([s]) => s.startsWith('UPDATE agrilink_offers SET'))!;

describe('MarketplaceService.setProduct (AgriLink listing details)', () => {
  it('keeps fields that were not sent (toggle only touches active)', async () => {
    const { db, calls } = fakeDb(productLookup);
    await new MarketplaceService(db, {} as any).setProduct(owner, 'p-1', { published: true } as any);
    const [sql, params] = updateCall(calls);
    expect(sql).toContain('active=$3');
    expect(sql).not.toMatch(/description=|sale_price=|images=|title=/);
    expect(params).toEqual(['org-1', 'p-1', true]);
  });

  it('saves the listing details and a timed sale', async () => {
    const { db, calls } = fakeDb(productLookup);
    const ends = inDays(7);
    await new MarketplaceService(db, {} as any).setProduct(owner, 'p-1', {
      published: true,
      title: ' NPK Đầu Trâu 20-20-15 ',
      unit: 'Bao 50kg',
      description: 'Phân bón cho cà phê giai đoạn nuôi trái.',
      images: ['/uploads/listings/org-1-p-1-1.webp'],
      salePrice: 420000,
      saleEndsAt: ends,
    } as any);
    const [sql, params] = updateCall(calls);
    expect(sql).toContain('title=$4');
    expect(sql).toContain('images=$7::jsonb');
    expect(sql).toContain('sale_price=$8');
    expect(sql).toContain('sale_ends_at=$9');
    expect(params).toEqual([
      'org-1', 'p-1', true,
      'NPK Đầu Trâu 20-20-15', 'Bao 50kg', 'Phân bón cho cà phê giai đoạn nuôi trái.',
      JSON.stringify(['/uploads/listings/org-1-p-1-1.webp']), 420000, ends,
    ]);
  });

  it('clears the end date together with the sale price', async () => {
    const { db, calls } = fakeDb(productLookup);
    await new MarketplaceService(db, {} as any).setProduct(owner, 'p-1', { published: true, salePrice: null } as any);
    const [sql, params] = updateCall(calls);
    expect(sql).toContain('sale_price=$4');
    expect(sql).toContain('sale_ends_at=$5');
    expect(params.slice(3)).toEqual([null, null]);
  });

  it('validates the sale against the new online price when one is sent', async () => {
    const { db } = fakeDb(productLookup);
    const svc = new MarketplaceService(db, {} as any);
    await expect(
      svc.setProduct(owner, 'p-1', { published: true, price: 400000, salePrice: 410000, saleEndsAt: inDays(3) } as any),
    ).rejects.toThrow('Giá khuyến mãi phải thấp hơn giá bán.');
    await expect(
      svc.setProduct(owner, 'p-1', { published: true, salePrice: 410000, saleEndsAt: inDays(3) } as any),
    ).resolves.toBeUndefined();
  });

  it('validates and saves inside one transaction with the listing row locked', async () => {
    const { db, calls } = fakeDb(productLookup);
    const transaction = jest.spyOn(db, 'transaction');
    await new MarketplaceService(db, {} as any).setProduct(owner, 'p-1', { published: true } as any);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(calls.find(([s]) => s.includes('AS "currentPrice"'))![0]).toContain('FOR UPDATE');
  });

  it('rejects images uploaded by another dealer', async () => {
    const { db } = fakeDb(productLookup);
    await expect(
      new MarketplaceService(db, {} as any).setProduct(owner, 'p-1', {
        published: true,
        images: ['/uploads/listings/org-2-p-9-1.webp'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MarketplaceService.uploadListingImage', () => {
  it('stores a WebP under the dealer prefix and returns its URL', async () => {
    const toFile = jest.fn().mockResolvedValue(undefined);
    const chain: Record<string, jest.Mock> = {};
    chain.rotate = jest.fn(() => chain);
    chain.resize = jest.fn(() => chain);
    chain.webp = jest.fn(() => chain);
    chain.toFile = toFile;
    (sharp as unknown as jest.Mock).mockReturnValue(chain);
    const { db } = fakeDb({ 'SELECT id FROM products': [{ id: 'p-1' }] });
    const result = await new MarketplaceService(db, {} as any).uploadListingImage(owner, 'p-1', {
      buffer: Buffer.from('x'),
    } as any);
    expect(result.url).toMatch(/^\/uploads\/listings\/org-1-p-1-\d+\.webp$/);
    expect(chain.resize).toHaveBeenCalledWith(1200, 1200, { fit: 'inside', withoutEnlargement: true });
    expect(toFile).toHaveBeenCalledWith(expect.stringMatching(/uploads[\\/]listings[\\/]org-1-p-1-\d+\.webp$/));
  });

  it('refuses products of another dealer and missing files', async () => {
    const { db } = fakeDb({});
    const svc = new MarketplaceService(db, {} as any);
    await expect(svc.uploadListingImage(owner, 'p-9', { buffer: Buffer.from('x') } as any)).rejects.toThrow('Sản phẩm không thuộc đại lý.');
    await expect(svc.uploadListingImage(owner, 'p-1', undefined)).rejects.toThrow('Vui lòng chọn ảnh.');
  });
});

describe('MarketplaceService.dealer sale offers', () => {
  it('shows the sale price, original price and listing images', async () => {
    const future = inDays(5);
    const { db, calls } = fakeDb({
      'FROM agrilink_organizations o LEFT JOIN admin_provinces': [{ id: 'org-1', name: 'An Phú' }],
      'AS "productImageUrl"': [
        { offerId: 'of-1', productId: 'p-1', name: 'NPK', unit: 'Bao 50kg', price: 420000, originalPrice: 450000, saleEndsAt: future, description: 'Mô tả', images: ['/uploads/listings/org-1-p-1-1.webp'], productImageUrl: '/uploads/p1.png', inStock: true },
        { offerId: 'of-2', productId: 'p-2', name: 'Urê', unit: 'bao', price: 380000, originalPrice: null, saleEndsAt: null, description: '', images: [], productImageUrl: '/uploads/p2.png', inStock: true },
      ],
    });
    const store = await new MarketplaceService(db, {} as any).dealer('org-1');
    expect(store.saleOffers[0]).toMatchObject({
      price: 420000,
      originalPrice: 450000,
      saleEndsAt: future,
      images: ['/uploads/listings/org-1-p-1-1.webp'],
      imageUrl: '/uploads/listings/org-1-p-1-1.webp',
    });
    expect(store.saleOffers[1]).toMatchObject({ images: ['/uploads/p2.png'], imageUrl: '/uploads/p2.png' });
    expect(store.saleOffers[1]).not.toHaveProperty('originalPrice');
    expect(store.saleOffers[1]).not.toHaveProperty('productImageUrl');
    const [sql] = calls.find(([s]) => s.includes('AS "productImageUrl"'))!;
    const s = saleOfferSql('f', 'p');
    expect(sql).toContain(`${s.price}::float AS price`);
    expect(sql).toContain(`${s.name} AS name`);
  });
});

describe('MarketplaceService.placeOrderTx sale pricing', () => {
  it('charges the effective (sale) price and stores the display name/unit', async () => {
    const { db, calls } = fakeDb({
      'SELECT id,fulfillment_options': [{ id: 'org-1', fulfillment_options: ['pickup'] }],
    });
    const svc = new MarketplaceService(db, {} as any);
    await svc
      .placeOrderTx({ query: db.query } as any, { id: 'farmer-1', role: 'farmer', memberships: [], suspended: false } as any, 'org-1', {
        kind: 'buy',
        items: [{ offerId: 'of-1', quantity: 1 }],
        fulfillment: 'pickup',
        contactName: 'A',
        contactPhone: '0912345678',
      } as any)
      .catch(() => undefined);
    const [sql] = calls.find(([s]) => s.includes('FROM agrilink_offers f') && s.includes('AS stale'))!;
    const s = saleOfferSql('f', 'p');
    expect(sql).toContain(`CASE WHEN f.kind='sale' THEN ${s.price} ELSE f.price END AS price`);
    expect(sql).toContain(`CASE WHEN f.kind='sale' THEN ${s.name} ELSE f.title END AS name`);
    expect(sql).toContain(`CASE WHEN f.kind='sale' THEN ${s.unit} ELSE f.unit END AS unit`);
  });
});
