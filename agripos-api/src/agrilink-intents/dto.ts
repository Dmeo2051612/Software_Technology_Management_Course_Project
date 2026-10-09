import { Type } from 'class-transformer';
import {
  IsIn,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ParseIntentDto {
  @IsString() @MinLength(1) @MaxLength(1000) text!: string;
}
export class CreateIntentDto {
  @IsString() @MinLength(1) @MaxLength(1000) rawText!: string;
  @IsIn(['sell', 'buy']) side!: 'sell' | 'buy';
  @IsOptional() @IsUUID() cropId?: string;
  @IsOptional() @IsString() @MaxLength(200) productQuery?: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantityKg?: number;
  @IsOptional() @IsString() @MaxLength(60) quantityText?: string;
  @Matches(/^[a-z0-9-]{1,40}$/) provinceCode!: string;
  @IsOptional() @Matches(/^[a-z0-9-]{1,40}$/) communeCode?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) windowStart!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) windowEnd!: string;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(2000000)
  expectedPricePerKg?: number;
  @IsIn(['pickup', 'dropoff', 'any']) fulfillmentPref!:
    | 'pickup'
    | 'dropoff'
    | 'any';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class CloseIntentDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class MyIntentsQuery {
  @IsOptional()
  @IsIn(['open', 'closed', 'expired', 'cancelled', 'matched'])
  status?: string;
}
export class LeadsQuery {
  @IsOptional() @IsIn(['sell', 'buy']) side?: 'sell' | 'buy';
  @IsOptional() @IsUUID() cropId?: string;
}

export class IntentItemDto {
  @IsUUID() offerId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) quantity?: number;
}
export class ChooseIntentDto {
  @IsUUID() organizationId!: string;
  @IsIn(['pickup', 'delivery', 'at_dealer']) fulfillment!: 'pickup' | 'delivery' | 'at_dealer';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) scheduledDate?: string;
  @IsOptional() @IsIn(['morning', 'afternoon']) scheduledSession?: 'morning' | 'afternoon';
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => IntentItemDto) items?: IntentItemDto[];
  @IsString() @MinLength(2) @MaxLength(150) contactName!: string;
  @Matches(/^\+?[0-9 .]{8,15}$/) contactPhone!: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
}
export class AcceptIntentOfferDto {
  @IsString() @MinLength(2) @MaxLength(150) contactName!: string;
  @Matches(/^\+?[0-9 .]{8,15}$/) contactPhone!: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
}
export class CreateIntentOfferDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) pricePerKg?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => IntentItemDto) products?: IntentItemDto[];
  @IsIn(['pickup', 'delivery', 'at_dealer']) fulfillment!: 'pickup' | 'delivery' | 'at_dealer';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) scheduledDate?: string;
  @IsOptional() @IsIn(['morning', 'afternoon']) scheduledSession?: 'morning' | 'afternoon';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) feePerKg?: number;
  @IsOptional() @IsString() @MaxLength(500) message?: string;
}
export class LeadOffersQuery { @IsOptional() @IsIn(['pending','accepted','declined','withdrawn','expired']) status?: string; }
