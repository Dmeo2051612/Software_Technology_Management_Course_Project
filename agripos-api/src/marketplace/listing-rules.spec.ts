import { BadRequestException } from '@nestjs/common';
import { validateListing } from './listing-rules';
import { saleOfferSql } from './sale-offer-sql';

const NOW = new Date('2026-09-29T03:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86400000).toISOString();
const ORG = '00000000-0000-4000-8000-000000000002';

describe('saleOfferSql', () => {
  it('builds one pricing rule for display name, unit and effective price', () => {
    const s = saleOfferSql('f', 'p');
    expect(s.name).toBe(`COALESCE(NULLIF(f.title,''),p.name)`);
    expect(s.unit).toBe(`COALESCE(NULLIF(f.unit,''),p.unit)`);
    expect(s.base).toBe('COALESCE(f.price,p."sellingPrice")');
    expect(s.promo).toBe('(f.sale_price IS NOT NULL AND f.sale_ends_at > now() AND f.sale_price < COALESCE(f.price,p."sellingPrice"))');
    expect(s.price).toBe(`CASE WHEN ${s.promo} THEN f.sale_price ELSE ${s.base} END`);
  });
});

describe('validateListing', () => {
  const ok = (dto: Parameters<typeof validateListing>[0], base = 450000) =>
    () => validateListing(dto, base, ORG, NOW);

  it('accepts a sale that is lower than the base price and ends within 90 days', () => {
    expect(ok({ salePrice: 420000, saleEndsAt: inDays(7) })).not.toThrow();
  });

  it('rejects a sale price that is not lower than the base price', () => {
    expect(ok({ salePrice: 450000, saleEndsAt: inDays(7) })).toThrow('Giá khuyến mãi phải thấp hơn giá bán.');
  });

  it('requires a future end date no more than 90 days ahead', () => {
    expect(ok({ salePrice: 400000 })).toThrow(BadRequestException);
    expect(ok({ salePrice: 400000, saleEndsAt: inDays(-1) })).toThrow('Ngày kết thúc khuyến mãi phải ở tương lai.');
    expect(ok({ salePrice: 400000, saleEndsAt: inDays(91) })).toThrow('Khuyến mãi tối đa 90 ngày.');
  });

  it('rejects an end date sent without a sale price', () => {
    expect(ok({ saleEndsAt: inDays(3) })).toThrow('Cần nhập giá khuyến mãi.');
  });

  it('allows clearing the sale', () => {
    expect(ok({ salePrice: null })).not.toThrow();
  });

  it('only accepts this dealer’s own uploaded images, at most 6', () => {
    const own = (n: number) => `/uploads/listings/${ORG}-p-${n}.webp`;
    expect(ok({ images: [own(1), own(2)] })).not.toThrow();
    expect(ok({ images: ['/uploads/listings/other-org-p-1.webp'] })).toThrow('Ảnh không hợp lệ.');
    expect(ok({ images: [`/uploads/listings/${ORG}-../../secret.webp`] })).toThrow('Ảnh không hợp lệ.');
    expect(ok({ images: [1, 2, 3, 4, 5, 6, 7].map(own) })).toThrow('Tối đa 6 ảnh.');
  });
});
