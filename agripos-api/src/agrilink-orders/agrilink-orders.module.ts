import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgrilinkOrder } from './entities/agrilink-order.entity';
import { AgrilinkOrderItem } from './entities/agrilink-order-item.entity';
import { AgrilinkOrderEvent } from './entities/agrilink-order-event.entity';
import { AgrilinkCustomerLink } from './entities/agrilink-customer-link.entity';
import { AgrilinkManageController } from './agrilink-manage.controller';
import { AgrilinkOrdersService } from './agrilink-orders.service';
import { AgrilinkCompleteService } from './agrilink-complete.service';
import { OrdersModule } from '../orders/orders.module';
import { WeighingSlipsModule } from '../weighing-slips/weighing-slips.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgrilinkOrder,
      AgrilinkOrderItem,
      AgrilinkOrderEvent,
      AgrilinkCustomerLink,
    ]),
    OrdersModule,
    WeighingSlipsModule,
  ],
  controllers: [AgrilinkManageController],
  providers: [AgrilinkOrdersService, AgrilinkCompleteService],
})
export class AgrilinkOrdersModule {}
