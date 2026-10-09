import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TenantEntity } from '../../organizations/tenant-context';

@Entity('agrilink_customer_links')
@Index(['organizationId', 'userId'], { unique: true })
export class AgrilinkCustomerLink extends TenantEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ type: 'uuid', nullable: true }) farmerId!: string | null;
}
