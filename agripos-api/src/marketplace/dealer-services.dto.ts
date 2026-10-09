import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  Matches,
} from 'class-validator';

export class ServiceWindowDto {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsIn(['morning', 'afternoon']) session!: 'morning' | 'afternoon';
  @IsInt() @Min(1) @Max(50) capacity!: number;
}

export class DealerServiceDto {
  @IsBoolean() active!: boolean;
  @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) cropIds!: string[];
  @IsIn(['radius', 'provinces']) areaMode!: 'radius' | 'provinces';
  @IsOptional() @IsInt() @Min(1) @Max(300) radiusKm!: number | null;
  @IsArray()
  @ArrayUnique()
  @Matches(/^[a-z0-9-]{1,40}$/, { each: true })
  provinceCodes!: string[];
  @IsIn(['free', 'per_trip', 'per_kg']) feeMode!:
    | 'free'
    | 'per_trip'
    | 'per_kg';
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999999)
  feeAmount!: number;
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(999999999999.999)
  minQuantityKg!: number;
  @IsInt() @Min(0) @Max(168) leadTimeHours!: number;
  @IsString() @MaxLength(500) note!: string;
  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => ServiceWindowDto)
  windows!: ServiceWindowDto[];
}
