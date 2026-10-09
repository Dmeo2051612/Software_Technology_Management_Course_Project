import { Module } from '@nestjs/common';
import { CommunityService } from './community.service';
import {
  CommunityController,
  CommunityGuard,
  NotificationsController,
  OrganizationsController,
  PlatformController,
} from './community.controller';

@Module({
  providers: [CommunityService, CommunityGuard],
  exports: [CommunityService],
  controllers: [
    CommunityController,
    NotificationsController,
    OrganizationsController,
    PlatformController,
  ],
})
export class CommunityModule {}
