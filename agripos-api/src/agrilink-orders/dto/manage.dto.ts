import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ListOrdersQuery {
  @IsOptional()
  @IsIn([
    'pending',
    'confirmed',
    'delivering',
    'completed',
    'rejected',
    'cancelled',
  ])
  status?: string;
  @IsOptional() @IsIn(['buy', 'sell']) kind?: 'buy' | 'sell';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
export class ItemEditDto {
  @IsUUID() itemId!: string;
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(999999999)
  quantity!: number;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999)
  unitPrice!: number;
}
export class UpdateItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemEditDto)
  items!: ItemEditDto[];
}
export class PartyDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() farmerId?: string;
  @IsOptional() @IsBoolean() createNew?: boolean;
}
export class CompleteOrderDto {
  @ValidateNested() @Type(() => PartyDto) party!: PartyDto;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemEditDto)
  items?: ItemEditDto[];
  @IsOptional() @IsIn(['cash', 'transfer', 'debt']) paymentMethod?:
    | 'cash'
    | 'transfer'
    | 'debt';
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999999)
  paidAmount!: number;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  @Min(0.001, { each: true })
  @Max(1000000, { each: true })
  weights?: number[];
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999)
  pricePerKg?: number;
  @IsOptional() @IsDateString() weighDate?: string;
}
export class StatsQuery {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
}
