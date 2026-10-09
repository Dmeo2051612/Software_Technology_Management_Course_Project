import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantEntity } from '../../organizations/tenant-context';
import { DecimalTransformer } from '../../common/transformers/decimal.transformer';
import { AgrilinkOrderItem } from './agrilink-order-item.entity';
import type { VoucherSnapshot } from '../../marketplace/voucher-rules';

export type AgrilinkOrderKind = 'buy' | 'sell';
export type AgrilinkOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'delivering'
  | 'completed'
  | 'rejected'
  | 'cancelled';
export type AgrilinkFulfillment = 'pickup' | 'delivery' | 'at_dealer';

@Entity('agrilink_orders')
@Index(['organizationId', 'code'], { unique: true })
@Index(['organizationId', 'status', 'createdAt'])
@Index(['requesterId', 'createdAt'])
export class AgrilinkOrder extends TenantEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid', nullable: true }) intentId!: string | null;
  @Column({ type: 'date', nullable: true }) scheduledDate!: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) scheduledSession!: string | null;
  @Column({ type: 'varchar', length: 30 }) code!: string;
  @Column({ type: 'uuid' }) requesterId!: string;
  @Column({ type: 'varchar', length: 10 }) kind!: AgrilinkOrderKind;
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: AgrilinkOrderStatus;
  @Column({ type: 'varchar', length: 20 }) fulfillment!: AgrilinkFulfillment;
  @Column({ type: 'varchar', length: 250, default: '' }) address!: string;
  @Column({ type: 'varchar', length: 1000, default: '' }) note!: string;
  @Column({ type: 'varchar', length: 150 }) contactName!: string;
  @Column({ type: 'varchar', length: 30 }) contactPhone!: string;
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    default: 0,
    transformer: DecimalTransformer,
  })
  estimatedTotal!: number;
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: DecimalTransformer,
  })
  finalTotal!: number | null;
  @Column({ type: 'uuid', nullable: true }) voucherId!: string | null;
  /** Quy tắc voucher lúc đặt đơn — tính lại tiền giảm khi đại lý sửa/chốt đơn. */
  @Column({ type: 'jsonb', nullable: true }) voucherSnapshot!: VoucherSnapshot | null;
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 0,
    default: 0,
    transformer: DecimalTransformer,
  })
  discountAmount!: number;
  @Column({ type: 'varchar', length: 500, nullable: true }) rejectReason!:
    | string
    | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) cancelReason!:
    | string
    | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) cancelledBy!:
    | 'buyer'
    | 'dealer'
    | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) posRefType!:
    | 'order'
    | 'weighing_slip'
    | null;
  @Column({ type: 'uuid', nullable: true }) posRefId!: string | null;
  @Column({ type: 'timestamp', nullable: true }) confirmedAt!: Date | null;
  @Column({ type: 'timestamp', nullable: true }) completedAt!: Date | null;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
  @OneToMany(() => AgrilinkOrderItem, (i) => i.order)
  items!: AgrilinkOrderItem[];
}
