import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) bio?: string;
  @IsOptional() @IsString() @MaxLength(100) region?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) openingHours?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['pickup', 'delivery', 'at_dealer'], { each: true })
  fulfillmentOptions?: string[];
  @IsOptional() @IsBoolean() marketplaceEnabled?: boolean;
  @IsOptional() @Matches(/^[a-z0-9-]{1,40}$/) provinceCode?: string | null;
  @IsOptional() @Matches(/^[a-z0-9-]{1,40}$/) communeCode?: string | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(8) @Max(24) lat?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(102) @Max(110) lng?: number | null;
}
export class ManageProductsQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true', 'false']) published?: 'true' | 'false';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class ProductListingDto {
  @IsBoolean() published!: boolean;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999999)
  price?: number | null;
  /** Tên hiển thị trên AgriLink ('' = dùng tên sản phẩm AgriPOS). */
  @IsOptional() @IsString() @MaxLength(180) title?: string;
  /** Quy cách hiển thị ('' = dùng đơn vị AgriPOS). */
  @IsOptional() @IsString() @MaxLength(50) unit?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  images?: string[];
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999999)
  salePrice?: number | null;
  @IsOptional() @IsISO8601() saleEndsAt?: string | null;
}
export class BuyOfferDto {
  @IsString() @MinLength(2) @MaxLength(180) title!: string;
  @IsOptional() @IsUUID() cropId?: string;
  @IsOptional() @IsIn(['coffee_fresh', 'coffee_bean', 'pepper']) commodityType?: string;
  @IsString() @MinLength(1) @MaxLength(50) unit!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999999) price!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) maxQuantityKg?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string;
}
export class UpdateBuyOfferDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(180) title?: string;
  @IsOptional() @IsUUID() cropId?: string;
  @IsOptional() @IsIn(['coffee_fresh', 'coffee_bean', 'pepper']) commodityType?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999999)
  price?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) maxQuantityKg?: number | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string | null;
}
export class OrderLineDto {
  @IsUUID() offerId!: string;
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999999)
  quantity!: number;
}
export class PlaceOrderDto {
  @IsIn(['buy', 'sell']) kind!: 'buy' | 'sell';
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
  @IsIn(['pickup', 'delivery', 'at_dealer']) fulfillment!:
    | 'pickup'
    | 'delivery'
    | 'at_dealer';
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsString() @MinLength(2) @MaxLength(150) contactName!: string;
  @Matches(/^\+?[0-9 .]{8,15}$/) contactPhone!: string;
  @IsOptional() @IsUUID() voucherId?: string;
}
export class CancelOrderDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
/** Tạo/sửa voucher; giới hạn chi tiết nằm ở validateVoucher. */
export class VoucherDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsIn(['amount', 'percent']) type?: 'amount' | 'percent';
  @IsOptional() @IsInt() value?: number;
  @IsOptional() @IsInt() maxDiscount?: number | null;
  @IsOptional() @IsInt() minOrder?: number;
  @IsOptional() @IsInt() quantity?: number;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
