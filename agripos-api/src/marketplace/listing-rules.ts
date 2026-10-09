import { BadRequestException } from '@nestjs/common';

export const MAX_LISTING_IMAGES = 6;
export const MAX_SALE_DAYS = 90;

export interface ListingChange {
  images?: string[];
  salePrice?: number | null;
  saleEndsAt?: string | null;
}

/**
 * Kiểm tra phần thay đổi tin bán vật tư.
 * @param basePrice giá bán online sau thay đổi (giá AgriLink hoặc giá AgriPOS)
 */
export function validateListing(dto: ListingChange, basePrice: number, orgId: string, now = new Date()): void {
  if (dto.images) {
    if (dto.images.length > MAX_LISTING_IMAGES) throw new BadRequestException(`Tối đa ${MAX_LISTING_IMAGES} ảnh.`);
    const prefix = `/uploads/listings/${orgId}-`;
    const invalid = dto.images.some(
      (url) => typeof url !== 'string' || !url.startsWith(prefix) || url.includes('..') || !/^[\w\-./]+$/.test(url),
    );
    if (invalid) throw new BadRequestException('Ảnh không hợp lệ.');
  }

  if (dto.salePrice === undefined) {
    if (dto.saleEndsAt) throw new BadRequestException('Cần nhập giá khuyến mãi.');
    return;
  }
  if (dto.salePrice === null) return;

  if (!dto.saleEndsAt) throw new BadRequestException('Cần chọn ngày kết thúc khuyến mãi.');
  const ends = new Date(dto.saleEndsAt);
  if (Number.isNaN(ends.getTime())) throw new BadRequestException('Ngày kết thúc khuyến mãi không hợp lệ.');
  if (ends <= now) throw new BadRequestException('Ngày kết thúc khuyến mãi phải ở tương lai.');
  if (ends.getTime() - now.getTime() > MAX_SALE_DAYS * 86400000)
    throw new BadRequestException(`Khuyến mãi tối đa ${MAX_SALE_DAYS} ngày.`);
  if (dto.salePrice >= basePrice) throw new BadRequestException('Giá khuyến mãi phải thấp hơn giá bán.');
}
