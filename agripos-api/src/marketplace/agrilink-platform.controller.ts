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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunityService } from '../community/community.service';
import { AgrilinkTrustService } from './agrilink-trust.service';
import { NoteDto, ReasonDto } from './agrilink-trust.dto';

@Controller('api/v1/platform/agrilink')
@UseGuards(JwtAuthGuard)
export class AgrilinkPlatformController {
  constructor(
    private readonly trust: AgrilinkTrustService,
    private readonly community: CommunityService,
  ) {}
  private viewer(r: { user: { userId: string } }) {
    return this.community.viewer(r.user.userId);
  }
  @Get('verifications') async verifications(
    @Req() r: any,
    @Query('status') status?: string,
  ) {
    return this.trust.verifications(await this.viewer(r), status);
  }
  @Post('verifications/:orgId/approve') async approve(
    @Req() r: any,
    @Param('orgId', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
  ) {
    return this.trust.decide(await this.viewer(r), id, 'approve', dto.note);
  }
  @Post('verifications/:orgId/reject') async reject(
    @Req() r: any,
    @Param('orgId', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
  ) {
    return this.trust.decide(await this.viewer(r), id, 'reject', dto.note);
  }
  @Post('verifications/:orgId/revoke') async revoke(
    @Req() r: any,
    @Param('orgId', ParseUUIDPipe) id: string,
    @Body() dto: NoteDto,
  ) {
    return this.trust.decide(await this.viewer(r), id, 'revoke', dto.note);
  }
  @Post('ratings/:id/hide') async hide(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.trust.hide(await this.viewer(r), id, dto.reason);
  }
  @Post('ratings/:id/unhide') async unhide(
    @Req() r: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.trust.unhide(await this.viewer(r), id);
  }
}
