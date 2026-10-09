import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RatingDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsBoolean() accurateWeight?: boolean;
  @IsOptional() @IsBoolean() paidOnTime?: boolean;
  @IsOptional() @IsBoolean() onTime?: boolean;
  @IsOptional() @IsBoolean() asDescribed?: boolean;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}
export class VerificationDto {
  @IsString() @MinLength(1) @MaxLength(200) legalName!: string;
  @Matches(/^\d{10}(?:-\d{3})?$/) taxCode!: string;
  @IsString() @MinLength(1) @MaxLength(300) businessAddress!: string;
}
export class NoteDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
export class ReasonDto {
  @IsString() @MinLength(1) @MaxLength(200) reason!: string;
}
