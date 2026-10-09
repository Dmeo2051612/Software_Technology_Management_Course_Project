import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MarketplaceService } from './marketplace.service';
import { VoucherDto } from './marketplace.dto';
import { VouchersService } from './vouchers.service';

type AuthRequest = { user: { userId: string } };

@Controller('api/v1/marketplace')
@UseGuards(JwtAuthGuard)
export class VouchersController {
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly vouchers: VouchersService,
  ) {}

  private viewer(r: AuthRequest) {
    return this.marketplace.viewer(r.user.userId);
  }

  @Get('manage/vouchers') async list(@Req() r: AuthRequest) {
    return this.vouchers.list(await this.viewer(r));
  }
  @Post('manage/vouchers') async create(@Req() r: AuthRequest, @Body() dto: VoucherDto) {
    return this.vouchers.create(await this.viewer(r), dto);
  }
  @Patch('manage/vouchers/:id') async update(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoucherDto,
  ) {
    return this.vouchers.update(await this.viewer(r), id, dto);
  }
  @Delete('manage/vouchers/:id') async remove(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.vouchers.remove(await this.viewer(r), id);
  }
  @Post('vouchers/:id/save') async save(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.vouchers.save(await this.viewer(r), id);
  }
}
