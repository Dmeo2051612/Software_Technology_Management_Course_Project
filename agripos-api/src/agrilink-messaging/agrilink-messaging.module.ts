import { Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import {
  AgrilinkMessagingController,
  AgrilinkMessagingPlatformController,
} from './agrilink-messaging.controller';
import { AgrilinkMessagingService } from './agrilink-messaging.service';

@Module({
  imports: [CommunityModule],
  controllers: [AgrilinkMessagingController, AgrilinkMessagingPlatformController],
  providers: [AgrilinkMessagingService],
})
export class AgrilinkMessagingModule {}
