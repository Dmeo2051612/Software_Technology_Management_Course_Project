import { Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import { AgrilinkPlatformController } from './agrilink-platform.controller';
import { AgrilinkTrustService } from './agrilink-trust.service';

@Module({
  imports: [CommunityModule],
  controllers: [AgrilinkPlatformController],
  providers: [AgrilinkTrustService],
  exports: [AgrilinkTrustService],
})
export class AgrilinkTrustModule {}
