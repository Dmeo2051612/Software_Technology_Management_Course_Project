import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantEntity } from '../../organizations/tenant-context';

@Entity('agrilink_order_events')
@Index(['orderId', 'createdAt'])
export class AgrilinkOrderEvent extends TenantEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) orderId!: string;
  @Column({ type: 'varchar', length: 20, nullable: true }) fromStatus!:
    | string
    | null;
  @Column({ type: 'varchar', length: 20 }) toStatus!: string;
  @Column({ type: 'uuid' }) actorId!: string;
  @Column({ type: 'varchar', length: 150 }) actorName!: string;
  @Column({ type: 'varchar', length: 500, default: '' }) note!: string;
  @CreateDateColumn() createdAt!: Date;
}
