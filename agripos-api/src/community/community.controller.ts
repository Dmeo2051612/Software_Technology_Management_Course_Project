import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunityService } from './community.service';
import type { CommunityViewer } from './community.service';
import {
  CommentDto,
  CommentEditDto,
  MembershipDto,
  ModerationDto,
  ModuleDto,
  OrganizationDto,
  PostDto,
  ProfileDto,
  ReportDto,
} from './community.dto';

type CommunityRequest = Request & {
  community: CommunityViewer;
  user: { userId: string };
};
@Injectable()
export class CommunityGuard implements CanActivate {
  constructor(private readonly service: CommunityService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<CommunityRequest>();
    req.community = await this.service.viewer(req.user.userId);
    return true;
  }
}

@Controller('api/v1/community')
@UseGuards(JwtAuthGuard, CommunityGuard)
@Throttle({ default: { limit: 180, ttl: 60000 } })
export class CommunityController {
  constructor(private readonly service: CommunityService) {}
  @Get('me') me(@Req() r: CommunityRequest) {
    return this.service.overview(r.community);
  }
  @Get('posts') posts(
    @Req() r: CommunityRequest,
    @Query() q: Record<string, string>,
  ) {
    return this.service.posts(r.community, q);
  }
  @Post('posts')
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  create(@Req() r: CommunityRequest, @Body() dto: PostDto) {
    return this.service.savePost(r.community, dto);
  }
  @Get('posts/:id') post(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.post(r.community, id);
  }
  @Patch('posts/:id') update(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostDto,
  ) {
    return this.service.savePost(r.community, dto, id);
  }
  @Delete('posts/:id') remove(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deletePost(r.community, id);
  }
  @Put('posts/:id/actions/:kind') action(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
  ) {
    return this.service.action(r.community, id, kind, true);
  }
  @Delete('posts/:id/actions/:kind') undo(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
  ) {
    return this.service.action(r.community, id, kind, false);
  }
  @Get('posts/:id/comments') comments(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.comments(r.community, id, cursor);
  }
  @Post('posts/:id/comments')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  comment(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentDto,
  ) {
    return this.service.comment(r.community, id, dto);
  }
  @Patch('comments/:id') editComment(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommentEditDto,
  ) {
    return this.service.editComment(r.community, id, dto.body);
  }
  @Delete('comments/:id') deleteComment(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.editComment(r.community, id);
  }
  @Put('posts/:id/helpful/:commentId') helpful(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.service.helpful(r.community, id, commentId, true);
  }
  @Delete('posts/:id/helpful/:commentId') unhelpful(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.service.helpful(r.community, id, commentId, false);
  }
  @Post('media')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Req() r: CommunityRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.upload(r.community, file);
  }
  @Get('media/:id') async media(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const m = await this.service.media(r.community, id);
    res.setHeader('Content-Type', m.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(m.bytes);
  }
  @Get('members/:id') profile(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.profile(r.community, id);
  }
  @Patch('profile') updateProfile(
    @Req() r: CommunityRequest,
    @Body() dto: ProfileDto,
  ) {
    return this.service.updateProfile(r.community, dto);
  }
  @Get('businesses/:id') business(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.business(r.community, id);
  }
  @Patch('businesses/:id') updateBusiness(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrganizationDto,
  ) {
    return this.service.updateBusiness(r.community, id, dto);
  }
  @Get('blocks') blocks(@Req() r: CommunityRequest) {
    return this.service.blocks(r.community);
  }
  @Put('blocks/:id') block(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.block(r.community, id, true);
  }
  @Delete('blocks/:id') unblock(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.block(r.community, id, false);
  }
  @Post('reports')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  report(@Req() r: CommunityRequest, @Body() dto: ReportDto) {
    return this.service.report(r.community, dto);
  }
}

@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard, CommunityGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
export class NotificationsController {
  constructor(private readonly service: CommunityService) {}
  @Get() list(@Req() r: CommunityRequest) {
    return this.service.notifications(r.community);
  }
  @Put('read') readAll(@Req() r: CommunityRequest) {
    return this.service.readNotification(r.community);
  }
  @Put(':id/read') read(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.readNotification(r.community, id);
  }
}

@Controller('api/v1/platform')
@UseGuards(JwtAuthGuard, CommunityGuard)
export class PlatformController {
  constructor(private readonly service: CommunityService) {}
  @Get('community/reports') reports(
    @Req() r: CommunityRequest,
    @Query('state') state: string,
  ) {
    return this.service.reports(r.community, state);
  }
  @Post('community/reports/:id/actions') moderate(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerationDto,
  ) {
    return this.service.moderate(r.community, id, dto);
  }
  @Get('organizations') organizations(@Req() r: CommunityRequest) {
    return this.service.organizations(r.community);
  }
  @Post('organizations') create(
    @Req() r: CommunityRequest,
    @Body() dto: OrganizationDto,
  ) {
    return this.service.createOrganization(r.community, dto);
  }
  @Patch('organizations/:id/modules') module(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModuleDto,
  ) {
    return this.service.module(r.community, id, dto.communityEnabled);
  }
}

@Controller('api/v1/organizations')
@UseGuards(JwtAuthGuard, CommunityGuard)
export class OrganizationsController {
  constructor(private readonly service: CommunityService) {}
  @Get(':id/members') members(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.members(r.community, id);
  }
  @Patch(':id/members/:userId') member(
    @Req() r: CommunityRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: MembershipDto,
  ) {
    return this.service.membership(
      r.community,
      id,
      userId,
      dto.active,
      dto.canPublish,
    );
  }
}
