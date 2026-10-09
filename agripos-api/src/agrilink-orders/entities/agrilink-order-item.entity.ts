import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantEntity } from '../../organizations/tenant-context';
import { DecimalTransformer } from '../../common/transformers/decimal.transformer';
import { AgrilinkOrder } from './agrilink-order.entity';

@Entity('agrilink_order_items')
@Index(['orderId'])
export class AgrilinkOrderItem extends TenantEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) orderId!: string;
  @ManyToOne(() => AgrilinkOrder, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: AgrilinkOrder;
  @Column({ type: 'uuid' }) offerId!: string;
  @Column({ type: 'uuid', nullable: true }) productId!: string | null;
  @Column({ type: 'uuid', nullable: true }) cropId!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) commodityType!:
    | string
    | null;
  @Column({ type: 'varchar', length: 180 }) itemName!: string;
  @Column({ type: 'varchar', length: 50 }) unit!: string;
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 3,
    transformer: DecimalTransformer,
  })
  quantity!: number;
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    transformer: DecimalTransformer,
  })
  unitPrice!: number;
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 3,
    nullable: true,
    transformer: DecimalTransformer,
  })
  finalQuantity!: number | null;
  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: DecimalTransformer,
  })
  finalUnitPrice!: number | null;
}
