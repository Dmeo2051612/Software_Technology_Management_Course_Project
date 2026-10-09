import { Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceAvailabilityController } from './marketplace-availability.controller';
import { MarketplaceService } from './marketplace.service';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { AgrilinkTrustModule } from './agrilink-trust.module';
import { AgriReferenceModule } from '../agri-reference/agri-reference.module';

@Module({
  imports: [CommunityModule, AgrilinkTrustModule, AgriReferenceModule],
  controllers: [MarketplaceController, MarketplaceAvailabilityController, VouchersController],
  providers: [MarketplaceService, VouchersService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
