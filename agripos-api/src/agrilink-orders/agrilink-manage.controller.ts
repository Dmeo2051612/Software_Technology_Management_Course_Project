import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { AgrilinkOrdersService, ManageUser } from './agrilink-orders.service';
import { AgrilinkCompleteService } from './agrilink-complete.service';
import {
  CompleteOrderDto,
  ListOrdersQuery,
  ReasonDto,
  StatsQuery,
  UpdateItemsDto,
} from './dto/manage.dto';
import { parseRangeStart, parseRangeEnd } from '../common/utils/date-range';

@ApiTags('AgriLink — Quản lý đơn')
@Controller('api/v1/agrilink-manage')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AgrilinkManageController {
  constructor(
    private readonly orders: AgrilinkOrdersService,
    private readonly completer: AgrilinkCompleteService,
  ) {}

  private u(r: any): ManageUser {
    return {
      userId: r.user.userId,
      role: r.user.role,
      organizationId: r.user.organizationId,
    };
  }

  @Get('stats')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Thống kê nhanh AgriLink (đơn mới, chờ xử lý, tỉ lệ chấp nhận…)',
  })
  stats(@Query() q: StatsQuery) {
    return this.orders.stats(parseRangeStart(q.from), parseRangeEnd(q.to));
  }

  @Get('orders')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Danh sách đơn AgriLink (filter, pagination)' })
  list(@Query() q: ListOrdersQuery) {
    return this.orders.list(q);
  }

  @Get('orders/:id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Chi tiết đơn AgriLink' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(id);
  }

  @Get('orders/:id/match')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({ summary: 'Gợi ý khách hàng/nông dân khớp với đơn' })
  match(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.match(id);
  }

  @Patch('orders/:id/items')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Sửa số lượng/đơn giá các dòng hàng' })
  items(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemsDto,
  ) {
    return this.orders.updateItems(id, dto, this.u(r));
  }

  @Post('orders/:id/confirm')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Xác nhận đơn' })
  confirm(@Req() r: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.transition(id, 'confirm', this.u(r));
  }

  @Post('orders/:id/reject')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Từ chối đơn' })
  reject(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.transition(id, 'reject', this.u(r), dto.reason);
  }

  @Post('orders/:id/deliver')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Chuyển đơn sang đang giao' })
  deliver(@Req() r: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.transition(id, 'deliver', this.u(r));
  }

  @Post('orders/:id/cancel')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Hủy đơn' })
  cancel(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.orders.transition(id, 'cancel', this.u(r), dto.reason);
  }

  @Post('orders/:id/complete')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER)
  @ApiOperation({
    summary: 'Hoàn tất đơn (khớp đối tác POS, tạo đơn hàng/phiếu cân)',
  })
  complete(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteOrderDto,
  ) {
    return this.completer.complete(id, dto, this.u(r));
  }
}
