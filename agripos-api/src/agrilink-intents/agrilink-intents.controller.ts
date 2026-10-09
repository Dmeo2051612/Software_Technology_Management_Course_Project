import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AgrilinkIntentsService } from './agrilink-intents.service';
import { AgrilinkMatchingService } from './agrilink-matching.service';
import {
  AcceptIntentOfferDto,
  ChooseIntentDto,
  CreateIntentOfferDto,
  LeadOffersQuery,
  CloseIntentDto,
  CreateIntentDto,
  LeadsQuery,
  MyIntentsQuery,
  ParseIntentDto,
} from './dto';

type AuthRequest = { user: { userId: string } };
@Controller('api/v1/marketplace')
@UseGuards(JwtAuthGuard)
export class AgrilinkIntentsController {
  constructor(private readonly service: AgrilinkIntentsService, private readonly matching: AgrilinkMatchingService) {}
  @Post('intents/parse')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async parse(@Req() req: AuthRequest, @Body() dto: ParseIntentDto) {
    return this.service.parse(
      await this.service.viewer(req.user.userId),
      dto.text,
    );
  }
  @Post('intents/preview')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async preview(@Req() req: AuthRequest, @Body() dto: CreateIntentDto) {
    return this.service.preview(
      await this.service.viewer(req.user.userId),
      dto,
    );
  }
  @Post('intents')
  async create(@Req() req: AuthRequest, @Body() dto: CreateIntentDto) {
    return this.service.create(await this.service.viewer(req.user.userId), dto);
  }
  @Get('my-intents')
  async mine(@Req() req: AuthRequest, @Query() q: MyIntentsQuery) {
    return this.service.mine(
      await this.service.viewer(req.user.userId),
      q.status,
    );
  }
  @Get('my-intents/:id')
  async detail(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(await this.service.viewer(req.user.userId), id);
  }
  @Post('my-intents/:id/close')
  async close(
    @Req() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseIntentDto,
  ) {
    return this.service.close(
      await this.service.viewer(req.user.userId),
      id,
      dto.reason,
    );
  }
  @Get('manage/leads')
  async leads(@Req() req: AuthRequest, @Query() q: LeadsQuery) {
    return this.service.leads(await this.service.viewer(req.user.userId), q);
  }
  @Post('my-intents/:id/choose')
  async choose(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChooseIntentDto) {
    return this.matching.choose(await this.service.viewer(req.user.userId), id, dto);
  }
  @Post('my-intents/:id/offers/:offerId/accept')
  async accept(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Param('offerId', ParseUUIDPipe) offerId: string, @Body() dto: AcceptIntentOfferDto) {
    return this.matching.accept(await this.service.viewer(req.user.userId), id, offerId, dto);
  }
  @Post('my-intents/:id/offers/:offerId/decline')
  async decline(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.matching.decline(await this.service.viewer(req.user.userId), id, offerId);
  }
  @Post('manage/leads/:intentId/offers')
  async offer(@Req() req: AuthRequest, @Param('intentId', ParseUUIDPipe) id: string, @Body() dto: CreateIntentOfferDto) {
    return this.matching.createOffer(await this.service.viewer(req.user.userId), id, dto);
  }
  @Get('manage/lead-offers')
  async leadOffers(@Req() req: AuthRequest, @Query() q: LeadOffersQuery) {
    return this.matching.leadOffers(await this.service.viewer(req.user.userId), q.status);
  }
  @Post('manage/lead-offers/:id/withdraw')
  async withdraw(@Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.matching.withdraw(await this.service.viewer(req.user.userId), id);
  }

}
