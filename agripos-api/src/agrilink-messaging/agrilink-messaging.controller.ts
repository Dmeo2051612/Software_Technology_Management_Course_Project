import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommunityService } from '../community/community.service';
import { AgrilinkMessagingService } from './agrilink-messaging.service';
import {
  AdminThreadsQuery,
  ComplaintDto,
  MessageDto,
  MessagesQuery,
  OpenChatDto,
  ProposalDto,
  ResolveDto,
  SupportDto,
  ThreadsQuery,
} from './dto';

type AuthRequest = { user: { userId: string } };

const imageUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|jpg|webp)$/.test(file.mimetype)) {
      cb(new BadRequestException('Chỉ chấp nhận file ảnh JPEG, PNG hoặc WebP'), false);
      return;
    }
    cb(null, true);
  },
});

@Controller('api/v1/marketplace')
@UseGuards(JwtAuthGuard)
// Khung chat kiểm tra tin mới mỗi 5 giây; giới hạn chung 30/phút theo IP sẽ chặn cả nhóm dùng chung mạng.
@Throttle({ default: { limit: 180, ttl: 60000 } })
export class AgrilinkMessagingController {
  constructor(
    private readonly service: AgrilinkMessagingService,
    private readonly community: CommunityService,
  ) {}
  private viewer(r: AuthRequest) {
    return this.community.viewer(r.user.userId);
  }

  @Get('threads') async threads(@Req() r: AuthRequest, @Query() q: ThreadsQuery) {
    return this.service.threads(await this.viewer(r), q);
  }
  @Get('threads/unread-count') async unread(@Req() r: AuthRequest, @Query() q: ThreadsQuery) {
    return this.service.unreadCount(await this.viewer(r), q.as);
  }
  @Get('threads/:id') async thread(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.thread(await this.viewer(r), id);
  }
  @Get('threads/:id/messages') async messages(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: MessagesQuery,
  ) {
    return this.service.messages(await this.viewer(r), id, q);
  }
  @Post('threads/:id/messages')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async post(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageDto) {
    return this.service.post(await this.viewer(r), id, dto);
  }
  @Post('threads/:id/read') async read(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.read(await this.viewer(r), id);
  }
  @Post('threads/:id/images')
  @UseInterceptors(imageUpload)
  async image(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadImage(await this.viewer(r), id, file);
  }

  @Post('chats') async openChat(@Req() r: AuthRequest, @Body() dto: OpenChatDto) {
    return this.service.openChat(await this.viewer(r), dto.dealerId);
  }
  @Get('orders/:id/chat') async chatForOrder(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.chatForOrder(await this.viewer(r), id);
  }
  @Post('chats/:id/block') async block(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setBlocked(await this.viewer(r), id, true);
  }
  @Post('chats/:id/unblock') async unblock(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setBlocked(await this.viewer(r), id, false);
  }

  @Post('my-orders/:id/complaints') async complain(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ComplaintDto,
  ) {
    return this.service.createComplaint(await this.viewer(r), id, dto);
  }
  @Post('threads/:id/propose') async propose(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposalDto,
  ) {
    return this.service.propose(await this.viewer(r), id, dto);
  }
  @Post('threads/:id/accept') async accept(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.accept(await this.viewer(r), id);
  }
  @Post('threads/:id/escalate') async escalate(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.escalate(await this.viewer(r), id);
  }

  @Post('support') async support(@Req() r: AuthRequest, @Body() dto: SupportDto) {
    return this.service.createSupport(await this.viewer(r), dto);
  }
  @Post('threads/:id/close') async close(@Req() r: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.closeSupport(await this.viewer(r), id);
  }
}

@Controller('api/v1/platform/agrilink')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 120, ttl: 60000 } })
export class AgrilinkMessagingPlatformController {
  constructor(
    private readonly service: AgrilinkMessagingService,
    private readonly community: CommunityService,
  ) {}
  @Get('threads') async threads(@Req() r: AuthRequest, @Query() q: AdminThreadsQuery) {
    return this.service.adminThreads(await this.community.viewer(r.user.userId), q);
  }
  @Post('threads/:id/resolve') async resolve(
    @Req() r: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDto,
  ) {
    return this.service.resolve(await this.community.viewer(r.user.userId), id, dto);
  }
}
