import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CommunityViewer } from '../community/community.service';
import {
  AdminThreadsQuery,
  ComplaintDto,
  MessageDto,
  MessagesQuery,
  ProposalDto,
  ResolveDto,
  SupportDto,
  ThreadsQuery,
} from './dto';
import {
  assertCanPost,
  COMPLAINT_AUTO_ESCALATE_HOURS,
  complaintCategories,
  complaintEligibility,
  DEALER_ROLES,
  nextComplaintStatus,
  Side,
  ThreadAccess,
  threadSide,
} from './messaging-rules';
import { ensureChatThread } from './order-thread';

type Q = (sql: string, params: unknown[]) => Promise<any[]>;

/** Số tin tối đa một người gửi trong một phút. */
export const MESSAGES_PER_MINUTE = 20;
type ThreadRow = ThreadAccess & {
  id: string;
  code: string;
  orderId: string | null;
  category: string | null;
  subject: string;
  buyerWish: string | null;
  dealerProposal: string | null;
  resolution: string | null;
  resolutionNote: string;
  resolvedAt: string | null;
  createdAt: string;
  lastMessageAt: string;
};

const THREAD_COLUMNS = `t.id,t.kind,t.code,t.buyer_id AS "buyerId",t.organization_id AS "organizationId",t.order_id AS "orderId",
  t.status,t.category,t.subject,t.buyer_wish AS "buyerWish",t.dealer_proposal AS "dealerProposal",
  t.blocked_by_buyer AS "blockedByBuyer",t.escalated_at AS "escalatedAt",t.resolved_at AS "resolvedAt",
  t.resolution,t.resolution_note AS "resolutionNote",t.created_at AS "createdAt",t.last_message_at AS "lastMessageAt"`;

/** Tin chưa đọc: tin của người khác (không tính dòng hệ thống) sau lần đọc cuối của người xem. */
const UNREAD = `EXISTS(SELECT 1 FROM agrilink_messages um WHERE um.thread_id=t.id AND um.sender_id IS DISTINCT FROM $1 AND um.sender_side<>'system'
  AND um.created_at > COALESCE((SELECT r.last_read_at FROM agrilink_thread_reads r WHERE r.thread_id=t.id AND r.user_id=$1),'epoch'))`;

const COUNTERPARTS = `o.name AS "dealerName",o.logo_url AS "dealerLogoUrl",
  COALESCE(cp.display_name,u."fullName") AS "buyerName",
  ord.code AS "orderCode",ord.kind AS "orderKind",
  (SELECT json_build_object('body',m.body,'side',m.sender_side,'hasImages',jsonb_array_length(m.images)>0,'orderId',m.order_id,'createdAt',m.created_at)
     FROM agrilink_messages m WHERE m.thread_id=t.id ORDER BY m.created_at DESC LIMIT 1) AS "lastMessage"`;
const COUNTERPART_JOINS = `LEFT JOIN agrilink_organizations o ON o.id=t.organization_id
  JOIN users u ON u.id=t.buyer_id LEFT JOIN community_profiles cp ON cp.user_id=u.id
  LEFT JOIN agrilink_orders ord ON ord.id=t.order_id`;

const LABEL = {
  wish: { exchange: 'Đổi hàng', refund: 'Hoàn tiền một phần', notice: 'Chỉ báo để đại lý biết' } as Record<string, string>,
  proposal: { refund: 'Bù tiền / hoàn một phần', exchange: 'Đổi hàng', explain: 'Giải thích, không thay đổi', other: 'Khác' } as Record<string, string>,
  resolution: { buyer_favored: 'Nông dân đúng', dealer_favored: 'Đại lý đúng', settled: 'Hai bên đã thoả thuận' } as Record<string, string>,
  category: {
    wrong_weight: 'Cân sai', late_payment: 'Chậm/thiếu tiền', no_show: 'Lỡ hẹn', wrong_item: 'Sai hàng',
    damaged: 'Hàng hỏng', late_delivery: 'Giao trễ', other: 'Khác',
  } as Record<string, string>,
};

@Injectable()
export class AgrilinkMessagingService {
  constructor(private readonly db: DataSource) {}

  // ---------- Access ----------

  private async loadThread(q: Q, id: string, lock = false): Promise<ThreadRow> {
    const [t] = await q(`SELECT ${THREAD_COLUMNS} FROM agrilink_threads t WHERE t.id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!t) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    return t;
  }

  private side(v: CommunityViewer, t: ThreadRow): Side {
    const side = threadSide(v, t);
    if (!side) throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    return side;
  }

  private dealerOrg(v: CommunityViewer): string {
    const id = v.organizationId;
    if (!id || !DEALER_ROLES.includes(v.role) || !v.memberships.some((m) => m.id === id))
      throw new ForbiddenException('Tài khoản không có quyền tin nhắn của đại lý.');
    return id;
  }

  /** Xem hàng đợi: quản trị viên hoặc người kiểm duyệt. */
  private platformStaff(v: CommunityViewer) {
    if (!v.platformRole) throw new ForbiddenException('Cần quyền quản trị nền tảng.');
  }

  /** Ra quyết định khiếu nại: chỉ quản trị viên. */
  private admin(v: CommunityViewer) {
    if (v.platformRole !== 'admin') throw new ForbiddenException('Chỉ quản trị viên được kết luận khiếu nại.');
  }

  // ---------- Inbox ----------

  async threads(v: CommunityViewer, query: ThreadsQuery) {
    const as = query.as ?? 'buyer';
    const params: unknown[] = [v.id];
    const filters: string[] = [as === 'dealer' ? `t.organization_id=$${params.push(this.dealerOrg(v))}` : 't.buyer_id=$1'];
    if (as === 'dealer') filters.push("t.kind<>'support'");
    if (query.kind) filters.push(`t.kind=$${params.push(query.kind)}`);
    if (query.status) filters.push(`t.status=$${params.push(query.status)}`);
    if (as === 'dealer') filters.push('NOT (t.kind=\'chat\' AND t.blocked_by_buyer)');
    return this.db.query(
      `SELECT ${THREAD_COLUMNS},${COUNTERPARTS},${UNREAD} AS unread
       FROM agrilink_threads t ${COUNTERPART_JOINS}
       WHERE ${filters.join(' AND ')} ORDER BY t.last_message_at DESC LIMIT 100`,
      params,
    );
  }

  async unreadCount(v: CommunityViewer, as: 'buyer' | 'dealer' = 'buyer') {
    const params: unknown[] = [v.id];
    let scope = 't.buyer_id=$1';
    if (as === 'dealer') {
      params.push(this.dealerOrg(v));
      scope = "t.organization_id=$2 AND t.kind<>'support' AND NOT (t.kind='chat' AND t.blocked_by_buyer)";
    }
    const [row] = await this.db.query(
      `SELECT count(*) FILTER (WHERE t.kind='chat')::int AS chat, count(*) FILTER (WHERE t.kind<>'chat')::int AS other
       FROM agrilink_threads t WHERE ${scope} AND ${UNREAD}`,
      params,
    );
    return { chat: row?.chat ?? 0, other: row?.other ?? 0 };
  }

  async thread(v: CommunityViewer, id: string) {
    const q: Q = (s, p) => this.db.query(s, p);
    const t = await this.loadThread(q, id);
    const side = this.side(v, t);
    const [extra] = await q(
      `SELECT ${COUNTERPARTS},o.region AS "dealerRegion",
         EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=t.organization_id AND d.status='verified') AS "dealerVerified"
       FROM agrilink_threads t ${COUNTERPART_JOINS} WHERE t.id=$1`,
      [id],
    );
    const orders = t.organizationId
      ? await q(
          `SELECT id,code,kind,status,COALESCE("finalTotal","estimatedTotal"-"discountAmount")::float AS total,"createdAt"
           FROM agrilink_orders WHERE "requesterId"=$1 AND "organizationId"=$2 ORDER BY "createdAt" DESC LIMIT 20`,
          [t.buyerId, t.organizationId],
        )
      : [];
    const autoEscalateAt =
      t.kind === 'complaint' && t.status === 'open'
        ? new Date(new Date(t.createdAt).getTime() + COMPLAINT_AUTO_ESCALATE_HOURS * 3600000).toISOString()
        : null;
    return { ...t, ...extra, side, orders, autoEscalateAt };
  }

  // ---------- Messages ----------

  async messages(v: CommunityViewer, id: string, query: MessagesQuery) {
    const q: Q = (s, p) => this.db.query(s, p);
    const t = await this.loadThread(q, id);
    const side = this.side(v, t);
    const select = `SELECT m.id,m.sender_side AS "senderSide",m.body,m.images,m.created_at AS "createdAt",
        CASE WHEN m.sender_side='buyer' THEN COALESCE(cp.display_name,u."fullName")
             WHEN m.sender_side='dealer' THEN o.name WHEN m.sender_side='admin' THEN 'AgriLink' END AS "senderName",
        CASE WHEN m.sender_side='dealer' THEN u."fullName" END AS "staffName",
        CASE WHEN m.order_id IS NULL THEN NULL ELSE json_build_object('id',ord.id,'code',ord.code,'kind',ord.kind,'status',ord.status,
          'total',COALESCE(ord."finalTotal",ord."estimatedTotal"-ord."discountAmount")::float,'fulfillment',ord.fulfillment,
          'items',(SELECT json_agg(json_build_object('name',i."itemName",'quantity',i.quantity::float,'unit',i.unit)) FROM agrilink_order_items i WHERE i."orderId"=ord.id)) END AS "order"
      FROM agrilink_messages m
      LEFT JOIN users u ON u.id=m.sender_id LEFT JOIN community_profiles cp ON cp.user_id=u.id
      LEFT JOIN agrilink_threads th ON th.id=m.thread_id LEFT JOIN agrilink_organizations o ON o.id=th.organization_id
      LEFT JOIN agrilink_orders ord ON ord.id=m.order_id
      WHERE m.thread_id=$1`;
    // Tên nhân viên chỉ dành cho kênh đại lý; nông dân chỉ thấy tên đại lý.
    const shape = (rows: any[]) => (side === 'dealer' ? rows : rows.map(({ staffName: _hidden, ...m }) => m));
    if (query.after) {
      const after = this.instant(query.after);
      return shape(await q(`${select} AND m.created_at > $2 ORDER BY m.created_at ASC LIMIT 100`, [id, after]));
    }
    const rows = query.before
      ? await q(`${select} AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT 50`, [id, this.instant(query.before)])
      : await q(`${select} ORDER BY m.created_at DESC LIMIT 50`, [id]);
    return shape(rows.reverse());
  }

  private instant(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Thời điểm không hợp lệ.');
    return d.toISOString();
  }

  private validateContent(threadId: string, dto: MessageDto) {
    const body = dto.body?.trim() ?? '';
    const images = dto.images ?? [];
    if (!body && !images.length) throw new BadRequestException('Tin nhắn trống.');
    const prefix = `/uploads/messages/${threadId}-`;
    if (images.some((url) => !url.startsWith(prefix) || url.includes('..') || !/^[\w\-./]+$/.test(url)))
      throw new BadRequestException('Ảnh không hợp lệ.');
    return { body, images };
  }

  private async insertMessage(q: Q, threadId: string, senderId: string | null, side: Side | 'system', body: string, images: string[] = []) {
    const [m] = await q(
      `INSERT INTO agrilink_messages(thread_id,sender_id,sender_side,body,images) VALUES($1,$2,$3,$4,$5::jsonb)
       RETURNING id,sender_side AS "senderSide",body,images,created_at AS "createdAt"`,
      [threadId, senderId, side, body, JSON.stringify(images)],
    );
    await q('UPDATE agrilink_threads SET last_message_at=now() WHERE id=$1', [threadId]);
    return m;
  }

  private async markRead(q: Q, threadId: string, userId: string) {
    await q(
      `INSERT INTO agrilink_thread_reads(thread_id,user_id,last_read_at) VALUES($1,$2,clock_timestamp())
       ON CONFLICT (thread_id,user_id) DO UPDATE SET last_read_at=excluded.last_read_at`,
      [threadId, userId],
    );
  }

  async post(v: CommunityViewer, id: string, dto: MessageDto) {
    if (v.suspended) throw new ForbiddenException('Tài khoản đang bị tạm khóa.');
    return this.db.transaction(async (em) => {
      const q: Q = (s, p) => em.query(s, p);
      const t = await this.loadThread(q, id, true);
      const side = this.side(v, t);
      assertCanPost(t, side);
      const { body, images } = this.validateContent(id, dto);
      // Giới hạn theo người gửi (không theo IP: nhiều bà con dùng chung mạng).
      const [rate] = await q(
        `SELECT count(*)::int AS recent FROM agrilink_messages WHERE sender_id=$1 AND created_at > now()-interval '1 minute'`,
        [v.id],
      );
      if ((rate?.recent ?? 0) >= MESSAGES_PER_MINUTE)
        throw new HttpException('Bạn gửi quá nhanh, vui lòng chờ một chút.', HttpStatus.TOO_MANY_REQUESTS);
      const message = await this.insertMessage(q, id, v.id, side, body, images);
      if (t.kind === 'support') {
        if (side === 'admin' && t.status !== 'answered') {
          await q(`UPDATE agrilink_threads SET status='answered' WHERE id=$1`, [id]);
          await this.notify(q, [t.buyerId], v.id, 'agrilink_support', `agrilink-support:${id}:${message.id}`);
        } else if (side === 'buyer' && t.status === 'answered') {
          await q(`UPDATE agrilink_threads SET status='open' WHERE id=$1`, [id]);
        }
      }
      await this.markRead(q, id, v.id);
      return message;
    });
  }

  async read(v: CommunityViewer, id: string) {
    const q: Q = (s, p) => this.db.query(s, p);
    const t = await this.loadThread(q, id);
    this.side(v, t);
    await this.markRead(q, id, v.id);
    return { read: true };
  }

  async uploadImage(v: CommunityViewer, id: string, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh.');
    const t = await this.loadThread((s, p) => this.db.query(s, p), id);
    assertCanPost(t, this.side(v, t));
    const dir = join(process.cwd(), 'uploads', 'messages');
    await mkdir(dir, { recursive: true });
    const name = `${id}-${Date.now()}.webp`;
    try {
      await sharp(file.buffer).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(dir, name));
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ.');
    }
    return { url: `/uploads/messages/${name}` };
  }

  // ---------- Chat ----------

  async openChat(v: CommunityViewer, dealerId: string) {
    if (v.memberships.some((m) => m.id === dealerId))
      throw new BadRequestException('Không thể nhắn tin cho chính đại lý của mình.');
    const [dealer] = await this.db.query('SELECT id FROM agrilink_organizations WHERE id=$1 AND marketplace_enabled', [dealerId]);
    if (!dealer) throw new NotFoundException('Không tìm thấy đại lý.');
    const id = await ensureChatThread((s, p) => this.db.query(s, p), v.id, dealerId);
    return this.thread(v, id);
  }

  /** Khung chat gắn với một đơn — cho người mua hoặc nhân viên đại lý của đơn đó. */
  async chatForOrder(v: CommunityViewer, orderId: string) {
    const [order] = await this.db.query(
      'SELECT "requesterId","organizationId" FROM agrilink_orders WHERE id=$1',
      [orderId],
    );
    if (!order) throw new NotFoundException('Không tìm thấy đơn.');
    if (order.requesterId === v.id) {
      const id = await ensureChatThread((s, p) => this.db.query(s, p), order.requesterId, order.organizationId);
      return { id };
    }
    // Đại lý không tự mở cuộc trò chuyện: chỉ vào khung chat đã có (tạo khi khách đặt đơn) và chưa bị chặn.
    if (!DEALER_ROLES.includes(v.role) || !v.memberships.some((m) => m.id === order.organizationId))
      throw new NotFoundException('Không tìm thấy đơn.');
    const [thread] = await this.db.query(
      `SELECT id FROM agrilink_threads WHERE kind='chat' AND buyer_id=$1 AND organization_id=$2 AND NOT blocked_by_buyer`,
      [order.requesterId, order.organizationId],
    );
    if (!thread) throw new NotFoundException('Khách chưa có cuộc trò chuyện với đại lý.');
    return { id: thread.id };
  }

  async setBlocked(v: CommunityViewer, id: string, blocked: boolean) {
    const q: Q = (s, p) => this.db.query(s, p);
    const t = await this.loadThread(q, id);
    if (t.kind !== 'chat' || this.side(v, t) !== 'buyer') throw new ForbiddenException('Chỉ người mua được chặn đại lý.');
    await q('UPDATE agrilink_threads SET blocked_by_buyer=$2 WHERE id=$1', [id, blocked]);
    return { blocked };
  }

  // ---------- Complaints ----------

  async createComplaint(v: CommunityViewer, orderId: string, dto: ComplaintDto) {
    if (v.suspended) throw new ForbiddenException('Tài khoản đang bị tạm khóa.');
    return this.db.transaction(async (em) => {
      const q: Q = (s, p) => em.query(s, p);
      const [order] = await q(
        `SELECT id,code,kind,status,"organizationId","requesterId","updatedAt" FROM agrilink_orders WHERE id=$1 FOR UPDATE`,
        [orderId],
      );
      if (!order || order.requesterId !== v.id) throw new NotFoundException('Không tìm thấy đơn.');
      const reason = complaintEligibility(order);
      if (reason) throw new BadRequestException(reason);
      if (!complaintCategories(order.kind).includes(dto.category)) throw new BadRequestException('Loại vấn đề không phù hợp với đơn.');
      const [open] = await q(`SELECT id FROM agrilink_threads WHERE order_id=$1 AND kind='complaint' AND status<>'resolved'`, [orderId]);
      if (open) throw new ConflictException('Đơn này đang có khiếu nại chưa giải quyết.');
      const [{ n }] = await q(`SELECT nextval('agrilink_complaint_seq')::int AS n`, []);
      const [t] = await q(
        `INSERT INTO agrilink_threads(kind,buyer_id,organization_id,order_id,code,category,subject,buyer_wish)
         VALUES('complaint',$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [v.id, order.organizationId, orderId, `KN-${String(n).padStart(4, '0')}`, dto.category,
         `${LABEL.category[dto.category]} · Đơn ${order.code}`, dto.wish ?? null],
      );
      // Ảnh khiếu nại được tải lên sau khi có mã; tin đầu tiên chỉ gồm nội dung.
      const wish = dto.wish ? ` Mong muốn: ${LABEL.wish[dto.wish]}.` : '';
      await this.insertMessage(q, t.id, v.id, 'buyer', `${LABEL.category[dto.category]} — ${dto.body.trim()}${wish}`);
      await this.insertMessage(q, t.id, null, 'system', 'Đã gửi khiếu nại đến đại lý. Đại lý có 3 ngày để phản hồi.');
      await this.markRead(q, t.id, v.id);
      await this.notifyDealer(q, order.organizationId, v.id, `agrilink-complaint:${t.id}:open:dealer`);
      return this.threadIn(q, v, t.id);
    });
  }

  private async threadIn(q: Q, v: CommunityViewer, id: string) {
    const t = await this.loadThread(q, id);
    return { ...t, side: this.side(v, t) };
  }

  async propose(v: CommunityViewer, id: string, dto: ProposalDto) {
    return this.complaintAction(v, id, 'propose', async (q, t) => {
      await q('UPDATE agrilink_threads SET dealer_proposal=$2 WHERE id=$1', [id, dto.proposal]);
      await this.insertMessage(q, id, v.id, 'dealer', `Đề xuất: ${LABEL.proposal[dto.proposal]} — ${dto.note.trim()}`);
      await this.notify(q, [t.buyerId], v.id, 'agrilink_complaint', `agrilink-complaint:${id}:dealer_replied:buyer`);
    });
  }

  async accept(v: CommunityViewer, id: string) {
    return this.complaintAction(v, id, 'accept', async (q, t) => {
      await q(`UPDATE agrilink_threads SET resolution='agreed',resolved_at=now() WHERE id=$1`, [id]);
      await this.insertMessage(q, id, null, 'system', 'Nông dân đồng ý với cách giải quyết. Khiếu nại đã đóng.');
      await this.notifyDealer(q, t.organizationId!, v.id, `agrilink-complaint:${id}:resolved:dealer`);
    });
  }

  async escalate(v: CommunityViewer, id: string) {
    return this.complaintAction(v, id, 'escalate', async (q, t) => {
      await q('UPDATE agrilink_threads SET escalated_at=now() WHERE id=$1', [id]);
      await this.insertMessage(q, id, null, 'system', 'Nông dân không đồng ý — đã chuyển AgriLink xem xét.');
      await this.notifyDealer(q, t.organizationId!, v.id, `agrilink-complaint:${id}:escalated:dealer`);
    });
  }

  async resolve(v: CommunityViewer, id: string, dto: ResolveDto) {
    this.admin(v);
    return this.complaintAction(v, id, 'resolve', async (q, t) => {
      await q('UPDATE agrilink_threads SET resolution=$2,resolution_note=$3,resolved_at=now() WHERE id=$1', [id, dto.resolution, dto.note.trim()]);
      await this.insertMessage(q, id, v.id, 'admin', `Kết luận của AgriLink: ${LABEL.resolution[dto.resolution]} — ${dto.note.trim()}`);
      await this.notify(q, [t.buyerId], v.id, 'agrilink_complaint', `agrilink-complaint:${id}:resolved:buyer`);
      await this.notifyDealer(q, t.organizationId!, v.id, `agrilink-complaint:${id}:resolved:dealer`);
    });
  }

  private async complaintAction(
    v: CommunityViewer,
    id: string,
    action: 'propose' | 'accept' | 'escalate' | 'resolve',
    effect: (q: Q, t: ThreadRow) => Promise<void>,
  ) {
    return this.db.transaction(async (em) => {
      const q: Q = (s, p) => em.query(s, p);
      const t = await this.loadThread(q, id, true);
      if (t.kind !== 'complaint') throw new NotFoundException('Không tìm thấy khiếu nại.');
      const side = action === 'resolve' ? (v.platformRole ? 'admin' : null) : this.side(v, t);
      if (!side) throw new ForbiddenException('Cần quyền quản trị nền tảng.');
      const next = nextComplaintStatus(t.status, action, side);
      await q('UPDATE agrilink_threads SET status=$2 WHERE id=$1', [id, next]);
      await effect(q, t);
      return this.threadIn(q, v, id);
    });
  }

  /** Mỗi giờ: khiếu nại đại lý chưa phản hồi sau 72 giờ tự chuyển AgriLink. */
  @Cron('15 * * * *')
  async autoEscalate() {
    const due: { id: string }[] = await this.db.query(
      `SELECT id FROM agrilink_threads
       WHERE kind='complaint' AND status='open' AND created_at <= now()-make_interval(hours => $1)`,
      [COMPLAINT_AUTO_ESCALATE_HOURS],
    );
    let escalated = 0;
    // Mỗi khiếu nại một giao dịch: đổi trạng thái, dòng hệ thống và thông báo cùng thành công hoặc cùng huỷ.
    for (const { id } of due) {
      await this.db.transaction(async (em) => {
        const q: Q = (s, p) => em.query(s, p);
        const [row] = await q(
          `UPDATE agrilink_threads SET status='escalated',escalated_at=now() WHERE id=$1 AND status='open'
           RETURNING id,buyer_id AS "buyerId",organization_id AS "organizationId"`,
          [id],
        );
        if (!row) return; // Đại lý vừa phản hồi.
        await this.insertMessage(q, row.id, null, 'system', 'Đại lý chưa phản hồi sau 3 ngày — đã tự chuyển AgriLink xem xét.');
        await this.notify(q, [row.buyerId], row.buyerId, 'agrilink_complaint', `agrilink-complaint:${row.id}:escalated:buyer`, true);
        await this.notifyDealer(q, row.organizationId, row.buyerId, `agrilink-complaint:${row.id}:escalated:dealer`);
        escalated += 1;
      });
    }
    return escalated;
  }

  // ---------- Support ----------

  async createSupport(v: CommunityViewer, dto: SupportDto) {
    return this.db.transaction(async (em) => {
      const q: Q = (s, p) => em.query(s, p);
      const [{ n }] = await q(`SELECT nextval('agrilink_support_seq')::int AS n`, []);
      const [t] = await q(
        `INSERT INTO agrilink_threads(kind,buyer_id,code,category,subject) VALUES('support',$1,$2,$3,$4) RETURNING id`,
        [v.id, `HT-${String(n).padStart(4, '0')}`, dto.category, dto.subject.trim()],
      );
      await this.insertMessage(q, t.id, v.id, 'buyer', dto.body.trim());
      await this.markRead(q, t.id, v.id);
      return this.threadIn(q, v, t.id);
    });
  }

  async closeSupport(v: CommunityViewer, id: string) {
    const q: Q = (s, p) => this.db.query(s, p);
    const t = await this.loadThread(q, id);
    const side = this.side(v, t);
    if (t.kind !== 'support' || side === 'dealer') throw new ForbiddenException('Không thể đóng yêu cầu này.');
    await q(`UPDATE agrilink_threads SET status='closed',resolved_at=now() WHERE id=$1`, [id]);
    await this.insertMessage(q, id, null, 'system', side === 'admin' ? 'AgriLink đã đóng yêu cầu.' : 'Bạn đã đóng yêu cầu.');
    return { closed: true };
  }

  // ---------- Admin ----------

  async adminThreads(v: CommunityViewer, query: AdminThreadsQuery) {
    this.platformStaff(v);
    const params: unknown[] = [v.id, query.kind];
    const filters = ['t.kind=$2'];
    if (query.kind === 'complaint') filters.push('t.escalated_at IS NOT NULL');
    if (query.status) filters.push(`t.status=$${params.push(query.status)}`);
    return this.db.query(
      `SELECT ${THREAD_COLUMNS},${COUNTERPARTS},${UNREAD} AS unread
       FROM agrilink_threads t ${COUNTERPART_JOINS}
       WHERE ${filters.join(' AND ')} ORDER BY t.last_message_at DESC LIMIT 200`,
      params,
    );
  }

  // ---------- Notifications ----------

  private async notify(q: Q, recipients: string[], actorId: string, kind: string, eventKey: string, includeActor = false) {
    for (const id of new Set(recipients)) {
      if (id === actorId && !includeActor) continue;
      await q(
        `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [id, actorId, kind, eventKey],
      );
    }
  }

  private async notifyDealer(q: Q, organizationId: string, actorId: string, eventKey: string) {
    await q(
      `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key)
       SELECT m.user_id,$2,'agrilink_complaint',$3 FROM agrilink_memberships m JOIN users u ON u.id=m.user_id
       WHERE m.organization_id=$1 AND m.active AND u.role IN ('owner','manager','cashier') AND m.user_id<>$2 ON CONFLICT DO NOTHING`,
      [organizationId, actorId, eventKey],
    );
  }
}
