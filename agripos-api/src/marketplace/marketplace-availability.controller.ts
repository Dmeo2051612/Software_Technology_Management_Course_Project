import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MarketplaceService } from './marketplace.service';

@Controller('api/v1/marketplace')
export class MarketplaceAvailabilityController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('dealers/:id/availability')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  availability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('kind') kind: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.marketplace.availability(id, kind, from, to);
  }
}
