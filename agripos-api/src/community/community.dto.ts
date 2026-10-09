import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  MinLength,
} from 'class-validator';

export class PostDto {
  @IsString() @MinLength(5) @MaxLength(5000) body!: string;
  @IsIn(['question', 'experience', 'market', 'announcement']) kind!: string;
  @IsIn(['draft', 'published']) state!: string;
  @IsOptional() @IsString() @MaxLength(80) crop?: string;
  @IsOptional() @IsString() @MaxLength(100) region?: string;
  @IsOptional() @IsString() @MaxLength(250) source?: string;
  @IsOptional() @IsString() @MaxLength(80) observedAt?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  topics!: string[];
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  mediaIds!: string[];
  @IsUUID() requestId!: string;
}
export class CommentDto {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsUUID() requestId!: string;
}
export class CommentEditDto {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}
export class ReportDto {
  @IsIn(['post', 'comment']) targetType!: string;
  @IsUUID() targetId!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
export class ModerationDto {
  @IsIn(['hide', 'restore', 'dismiss', 'suspend', 'unsuspend']) action!: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
export class ProfileDto {
  @IsString() @MinLength(2) @MaxLength(100) displayName!: string;
  @IsString() @MaxLength(1000) bio!: string;
  @IsString() @MaxLength(100) region!: string;
  @IsString() @MaxLength(150) crops!: string;
  @IsOptional() @Matches(/^[a-z0-9-]{1,40}$/) provinceCode?: string | null;
  @IsOptional() @Matches(/^[a-z0-9-]{1,40}$/) communeCode?: string | null;
}
export class OrganizationDto {
  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsString() @MaxLength(1000) bio!: string;
  @IsString() @MaxLength(100) region!: string;
  @IsOptional() @IsUUID() ownerId?: string;
}
export class MembershipDto {
  @IsBoolean() canPublish!: boolean;
  @IsBoolean() active!: boolean;
}
export class ModuleDto {
  @IsBoolean() communityEnabled!: boolean;
}
