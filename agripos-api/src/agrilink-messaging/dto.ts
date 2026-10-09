import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class MessageDto {
  @IsOptional() @IsString() @MaxLength(2000) body?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) @MaxLength(300, { each: true }) images?: string[];
}
export class OpenChatDto {
  @IsUUID() dealerId!: string;
}
export class ThreadsQuery {
  @IsOptional() @IsIn(['buyer', 'dealer']) as?: 'buyer' | 'dealer';
  @IsOptional() @IsIn(['chat', 'complaint', 'support']) kind?: 'chat' | 'complaint' | 'support';
  @IsOptional() @IsIn(['open', 'dealer_replied', 'escalated', 'resolved', 'answered', 'closed']) status?: string;
}
export class MessagesQuery {
  @IsOptional() @IsString() @MaxLength(40) after?: string;
  @IsOptional() @IsString() @MaxLength(40) before?: string;
}
export class ComplaintDto {
  @IsString() @MaxLength(30) category!: string;
  @IsString() @MinLength(20) @MaxLength(2000) body!: string;
  @IsOptional() @IsIn(['exchange', 'refund', 'notice']) wish?: 'exchange' | 'refund' | 'notice';
}
export class ProposalDto {
  @IsIn(['refund', 'exchange', 'explain', 'other']) proposal!: 'refund' | 'exchange' | 'explain' | 'other';
  @IsString() @MinLength(5) @MaxLength(1000) note!: string;
}
export class ResolveDto {
  @IsIn(['buyer_favored', 'dealer_favored', 'settled']) resolution!: 'buyer_favored' | 'dealer_favored' | 'settled';
  @IsString() @MinLength(5) @MaxLength(500) note!: string;
}
export class SupportDto {
  @IsIn(['account', 'orders', 'payment', 'dealer', 'other']) category!: string;
  @IsString() @MinLength(5) @MaxLength(180) subject!: string;
  @IsString() @MinLength(10) @MaxLength(2000) body!: string;
}
export class AdminThreadsQuery {
  @IsIn(['complaint', 'support']) kind!: 'complaint' | 'support';
  @IsOptional() @IsIn(['open', 'escalated', 'resolved', 'answered', 'closed']) status?: string;
}
