import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { validateLocation } from '../agri-reference/location';
import { describeNotification, NotificationRow } from './notification-describe';

/** Phần thứ 2 của event_key dạng uuid (null nếu không hợp lệ) — so khớp trực tiếp khoá chính để dùng index. */
const KEY_UUID = `(CASE WHEN split_part(n.event_key,':',2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN split_part(n.event_key,':',2)::uuid END)`;
import sharp from 'sharp';
import {
  CommentDto,
  ModerationDto,
  OrganizationDto,
  PostDto,
  ProfileDto,
  ReportDto,
} from './community.dto';

export interface CommunityViewer {
  id: string;
  organizationId: string | null;
  role: string;
  displayName: string;
  suspended: boolean;
  platformRole: string | null;
  bio: string;
  region: string;
  crops: string;
  memberships: {
    id: string;
    name: string;
    canPublish: boolean;
    communityEnabled: boolean;
  }[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const blocked = (author: string, viewer = '$1') =>
  `EXISTS(SELECT 1 FROM community_blocks b WHERE (b.blocker_id=${viewer} AND b.blocked_id=${author}) OR (b.blocked_id=${viewer} AND b.blocker_id=${author}))`;
const visible = (alias = 'p') =>
  `${alias}.state='published' AND NOT ${blocked(`${alias}.author_id`)} AND ( ${alias}.organization_id IS NULL OR EXISTS(SELECT 1 FROM agrilink_organizations vo WHERE vo.id=${alias}.organization_id AND vo.community_enabled))`;
const person = (u = 'u', profile = 'cp') =>
  `json_build_object('id',${u}.id,'name',COALESCE(${profile}.display_name,${u}."fullName"),'role',${u}.role)`;

@Injectable()
export class CommunityService {
  constructor(private readonly db: DataSource) {}

  async viewer(id: string): Promise<CommunityViewer> {
    const [v] = await this.db.query(
      `SELECT u.id,u.role,u."organizationId" AS "organizationId",COALESCE(cp.display_name,u."fullName") AS "displayName",
      COALESCE(cp.suspended,false) AS suspended,pr.role AS "platformRole",COALESCE(cp.bio,'') bio,
      COALESCE(cp.region,'') region,COALESCE(cp.crops,'') crops
      FROM users u LEFT JOIN community_profiles cp ON cp.user_id=u.id LEFT JOIN agrilink_platform_roles pr ON pr.user_id=u.id WHERE u.id=$1 AND u."isActive"`,
      [id],
    );
    if (!v) throw new ForbiddenException('Tài khoản không hoạt động');
    v.memberships = await this.db.query(
      `SELECT o.id,o.name,m.can_publish AS "canPublish",o.community_enabled AS "communityEnabled"
      FROM agrilink_memberships m JOIN agrilink_organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.active ORDER BY o.name`,
      [id],
    );
    return v;
  }

  enabled(v: CommunityViewer) {
    if (
      v.role !== 'farmer' &&
      !v.platformRole &&
      !v.memberships.some((m) => m.communityEnabled)
    ) {
      throw new ForbiddenException(
        'Cộng đồng chưa được bật cho doanh nghiệp của bạn.',
      );
    }
  }
  writable(v: CommunityViewer) {
    this.enabled(v);
    if (v.suspended)
      throw new ForbiddenException(
        'Quyền đăng bài và bình luận của bạn đang bị tạm khóa.',
      );
  }
  moderator(v: CommunityViewer) {
    if (!v.platformRole)
      throw new ForbiddenException(
        'Chỉ người quản trị cộng đồng được thực hiện thao tác này.',
      );
  }
  admin(v: CommunityViewer) {
    if (v.platformRole !== 'admin')
      throw new ForbiddenException('Cần quyền quản trị nền tảng.');
  }

  async overview(v: CommunityViewer) {
    this.enabled(v);
    const [counts] = await this.db.query(
      `SELECT
      (SELECT count(*)::int FROM community_posts p WHERE ${visible()}) AS posts,
      (SELECT count(DISTINCT author_id)::int FROM community_posts p WHERE ${visible()}) AS contributors`,
      [v.id],
    );
    return {
      viewer: v,
      topics: await this.db.query(
        'SELECT * FROM community_topics ORDER BY name',
      ),
      counts,
      businesses: await this.db.query(
        'SELECT id,name,region,bio FROM agrilink_organizations WHERE community_enabled ORDER BY name LIMIT 8',
      ),
    };
  }

  private cursor(raw?: string) {
    if (!raw) return null;
    try {
      if (raw.length > 200) throw new Error();
      const value = JSON.parse(Buffer.from(raw, 'base64url').toString());
      if (!UUID.test(value.id) || !Number.isFinite(Date.parse(value.at)))
        throw new Error();
      return value as { id: string; at: string };
    } catch {
      throw new BadRequestException('Vị trí phân trang không hợp lệ');
    }
  }
  private nextCursor(row: any) {
    return Buffer.from(
      JSON.stringify({ id: row.id, at: row.createdAt }),
    ).toString('base64url');
  }

  private postSelect() {
    return `SELECT p.id,p.body,p.kind,p.state,p.crop,p.region,p.source,p.observed_at AS "observedAt",p.topics,
      p.created_at AS "createdAt",p.updated_at AS "updatedAt",p.helpful_comment_id AS "helpfulCommentId",
      CASE WHEN p.author_id=$1 THEN p.moderation_reason END AS "moderationReason",
      ${person()} AS author,
      CASE WHEN o.id IS NOT NULL THEN json_build_object('id',o.id,'name',o.name,
        'verified',EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=o.id AND d.status='verified')) END AS organization,
      (SELECT COALESCE(json_agg(m.id ORDER BY m.created_at),'[]'::json) FROM community_media m WHERE m.post_id=p.id) AS "mediaIds",
      (SELECT count(*)::int FROM community_actions a WHERE a.post_id=p.id AND a.kind='like' AND NOT ${blocked('a.user_id')}) AS "likeCount",
      (SELECT count(*)::int FROM community_comments c WHERE c.post_id=p.id AND c.state='published' AND NOT ${blocked('c.author_id')} AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM community_comments par WHERE par.id=c.parent_id AND par.state='published' AND NOT ${blocked('par.author_id')}))) AS "commentCount",
      EXISTS(SELECT 1 FROM community_actions a WHERE a.post_id=p.id AND a.user_id=$1 AND a.kind='like') AS liked,
      EXISTS(SELECT 1 FROM community_actions a WHERE a.post_id=p.id AND a.user_id=$1 AND a.kind='bookmark') AS saved,
      EXISTS(SELECT 1 FROM community_actions a WHERE a.post_id=p.id AND a.user_id=$1 AND a.kind='subscription') AS subscribed
      FROM community_posts p JOIN users u ON u.id=p.author_id LEFT JOIN community_profiles cp ON cp.user_id=u.id
      LEFT JOIN agrilink_organizations o ON o.id=p.organization_id`;
  }

  async posts(v: CommunityViewer, filter: Record<string, string>) {
    this.enabled(v);
    const params: unknown[] = [v.id];
    const conditions = [
      filter.view === 'mine'
        ? `p.author_id=$1 AND p.state<>'deleted'`
        : visible(),
    ];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', '$' + params.length));
    };
    if (filter.view === 'saved')
      conditions.push(
        `EXISTS(SELECT 1 FROM community_actions a WHERE a.post_id=p.id AND a.user_id=$1 AND a.kind='bookmark')`,
      );
    if (filter.view === 'following')
      conditions.push(
        `EXISTS(SELECT 1 FROM community_actions a WHERE a.post_id=p.id AND a.user_id=$1 AND a.kind='subscription')`,
      );
    if (filter.topic) add('? = ANY(p.topics)', filter.topic.slice(0, 50));
    if (filter.kind) add('p.kind=?', filter.kind);
    if (filter.crop)
      add(
        'unaccent(p.crop) ILIKE unaccent(?)',
        '%' + filter.crop.slice(0, 80) + '%',
      );
    if (filter.region)
      add(
        'unaccent(p.region) ILIKE unaccent(?)',
        '%' + filter.region.slice(0, 100) + '%',
      );
    if (filter.q)
      add(
        `unaccent(concat_ws(' ',p.body,p.crop,p.region,cp.display_name,u."fullName",o.name)) ILIKE unaccent(?)`,
        '%' + filter.q.slice(0, 150) + '%',
      );
    for (const [key, column] of [
      ['author', 'p.author_id'],
      ['business', 'p.organization_id'],
    ]) {
      if (filter[key]) {
        if (!UUID.test(filter[key]))
          throw new BadRequestException('Hồ sơ không hợp lệ');
        add(column + '=?', filter[key]);
      }
    }
    const cursor = this.cursor(filter.cursor);
    if (cursor) {
      params.push(cursor.at, cursor.id);
      conditions.push(
        `(p.created_at,p.id)<($${params.length - 1}::timestamptz,$${params.length}::uuid)`,
      );
    }
    const rows = await this.db.query(
      `${this.postSelect()} WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC,p.id DESC LIMIT 13`,
      params,
    );
    const more = rows.length > 12;
    const items = rows.slice(0, 12);
    return {
      items,
      nextCursor: more ? this.nextCursor(items[items.length - 1]) : null,
    };
  }

  async post(v: CommunityViewer, id: string) {
    this.enabled(v);
    const [post] = await this.db.query(
      `${this.postSelect()} WHERE p.id=$2 AND (${visible()} OR (p.author_id=$1 AND p.state<>'deleted'))`,
      [v.id, id],
    );
    if (!post)
      throw new NotFoundException(
        'Bài viết không còn hiển thị hoặc bạn không có quyền xem.',
      );
    return post;
  }

  private async lockPost(
    em: EntityManager,
    v: CommunityViewer,
    id: string,
    own = false,
  ) {
    const [p] = await em.query(
      `SELECT p.* FROM community_posts p WHERE p.id=$2 AND ${own ? "p.author_id=$1 AND p.state IN ('draft','published')" : visible()} FOR UPDATE OF p`,
      [v.id, id],
    );
    if (!p) throw new NotFoundException('Bài viết không còn khả dụng.');
    return p;
  }

  async savePost(v: CommunityViewer, dto: PostDto, id?: string) {
    this.writable(v);
    if (dto.body.trim().length < 5)
      throw new BadRequestException('Bài viết cần ít nhất 5 ký tự.');
    if (
      dto.kind === 'market' &&
      (!dto.source?.trim() || !dto.observedAt?.trim())
    )
      throw new BadRequestException(
        'Thông tin thị trường cần nguồn và thời điểm ghi nhận.',
      );
    if (dto.kind === 'announcement' && !dto.organizationId)
      throw new BadRequestException(
        'Thông báo cần được đăng bởi đại diện đại lý.',
      );
    const result = await this.db.transaction(async (em) => {
      if (dto.organizationId) {
        const [membership] = await em.query(
          `SELECT m.user_id FROM agrilink_memberships m JOIN agrilink_organizations o ON o.id=m.organization_id
          WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active AND m.can_publish AND o.community_enabled FOR SHARE OF m,o`,
          [v.id, dto.organizationId],
        );
        if (!membership)
          throw new ForbiddenException(
            'Bạn không có quyền đăng nhân danh doanh nghiệp này.',
          );
      }
      const topics = await em.query(
        'SELECT id FROM community_topics WHERE id=ANY($1::text[])',
        [dto.topics],
      );
      if (topics.length !== dto.topics.length)
        throw new BadRequestException('Chủ đề không hợp lệ.');
      let postId = id;
      if (id) {
        const previous = await this.lockPost(em, v, id, true);
        if ((previous.organization_id || undefined) !== dto.organizationId)
          throw new BadRequestException(
            'Không thể thay đổi danh tính tác giả khi sửa bài.',
          );
      } else {
        const [existing] = await em.query(
          'SELECT id FROM community_posts WHERE author_id=$1 AND request_id=$2',
          [v.id, dto.requestId],
        );
        if (existing) return existing.id;
        const [created] = await em.query(
          `INSERT INTO community_posts(author_id,organization_id,body,kind,state,request_id)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(author_id,request_id) DO NOTHING RETURNING id`,
          [
            v.id,
            dto.organizationId || null,
            dto.body.trim(),
            dto.kind,
            dto.state,
            dto.requestId,
          ],
        );
        if (!created)
          return (
            await em.query(
              'SELECT id FROM community_posts WHERE author_id=$1 AND request_id=$2',
              [v.id, dto.requestId],
            )
          )[0].id;
        postId = created.id;
      }
      if (dto.mediaIds.length) {
        const media = await em.query(
          'SELECT id FROM community_media WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND (post_id IS NULL OR post_id=$3) FOR UPDATE',
          [dto.mediaIds, v.id, postId],
        );
        if (media.length !== dto.mediaIds.length)
          throw new ForbiddenException(
            'Ảnh không thuộc bài viết/tài khoản này.',
          );
      }
      await em.query(
        `UPDATE community_posts SET body=$2,kind=$3,state=$4,crop=$5,region=$6,source=$7,observed_at=$8,topics=$9,updated_at=now() WHERE id=$1`,
        [
          postId,
          dto.body.trim(),
          dto.kind,
          dto.state,
          dto.crop?.trim() || '',
          dto.region?.trim() || '',
          dto.source?.trim() || '',
          dto.observedAt?.trim() || '',
          dto.topics,
        ],
      );
      await em.query(
        'UPDATE community_media SET post_id=NULL WHERE post_id=$1 AND NOT(id=ANY($2::uuid[]))',
        [postId, dto.mediaIds],
      );
      await em.query(
        'UPDATE community_media SET post_id=$1 WHERE id=ANY($2::uuid[])',
        [postId, dto.mediaIds],
      );
      await em.query(
        "INSERT INTO community_actions(user_id,post_id,kind) VALUES($1,$2,'subscription') ON CONFLICT DO NOTHING",
        [v.id, postId],
      );
      return postId;
    });
    return this.post(v, result);
  }

  async deletePost(v: CommunityViewer, id: string) {
    this.enabled(v);
    const rows = await this.db.query(
      "UPDATE community_posts SET state='deleted',updated_at=now() WHERE id=$1 AND author_id=$2 AND state<>'deleted' RETURNING id",
      [id, v.id],
    );
    if (!rows.length) throw new NotFoundException();
    return { id };
  }

  async action(v: CommunityViewer, id: string, kind: string, enabled: boolean) {
    this.writable(v);
    if (!['like', 'bookmark', 'subscription'].includes(kind))
      throw new BadRequestException();
    await this.db.transaction(async (em) => {
      await this.lockPost(em, v, id);
      if (enabled)
        await em.query(
          'INSERT INTO community_actions(user_id,post_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [v.id, id, kind],
        );
      else
        await em.query(
          'DELETE FROM community_actions WHERE user_id=$1 AND post_id=$2 AND kind=$3',
          [v.id, id, kind],
        );
    });
    return { enabled };
  }

  async comments(v: CommunityViewer, postId: string, after?: string) {
    await this.post(v, postId);
    const [p] = await this.db.query(
      'SELECT state FROM community_posts WHERE id=$1',
      [postId],
    );
    if (p.state !== 'published') return { items: [], nextCursor: null };
    const cursor = this.cursor(after);
    const rows = await this.db.query(
      `SELECT c.id,c.body,c.parent_id AS "parentId",c.created_at AS "createdAt",${person()} AS author
      FROM community_comments c JOIN users u ON u.id=c.author_id LEFT JOIN community_profiles cp ON cp.user_id=u.id
      WHERE c.post_id=$2 AND c.state='published' AND NOT ${blocked('c.author_id')}
      AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM community_comments par WHERE par.id=c.parent_id AND par.state='published' AND NOT ${blocked('par.author_id')}))
      ${cursor ? 'AND (c.created_at,c.id)>($3::timestamptz,$4::uuid)' : ''}
      ORDER BY c.created_at,c.id LIMIT 41`,
      cursor ? [v.id, postId, cursor.at, cursor.id] : [v.id, postId],
    );
    const items = rows.slice(0, 40);
    return {
      items,
      nextCursor:
        rows.length > 40 ? this.nextCursor(items[items.length - 1]) : null,
    };
  }

  async comment(v: CommunityViewer, postId: string, dto: CommentDto) {
    this.writable(v);
    if (!dto.body.trim())
      throw new BadRequestException('Vui lòng nhập bình luận.');
    return this.db.transaction(async (em) => {
      await this.lockPost(em, v, postId);
      if (dto.parentId) {
        const [parent] = await em.query(
          `SELECT c.id FROM community_comments c WHERE c.id=$2 AND c.post_id=$3 AND c.state='published' AND c.parent_id IS NULL AND NOT ${blocked('c.author_id')} FOR SHARE`,
          [v.id, dto.parentId, postId],
        );
        if (!parent)
          throw new BadRequestException(
            'Chỉ trả lời bình luận gốc đang hiển thị trong bài này.',
          );
      }
      const [c] = await em.query(
        `INSERT INTO community_comments(post_id,author_id,parent_id,body,request_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(author_id,request_id) DO NOTHING RETURNING id`,
        [postId, v.id, dto.parentId || null, dto.body.trim(), dto.requestId],
      );
      if (!c) return { duplicate: true };
      await em.query(
        `INSERT INTO community_notifications(recipient_id,actor_id,post_id,comment_id,kind,event_key)
        SELECT a.user_id,$1,$2,$3,'comment',$4 FROM community_actions a JOIN users u ON u.id=a.user_id
        WHERE a.post_id=$2 AND a.kind='subscription' AND a.user_id<>$1 AND u."isActive" AND NOT ${blocked('a.user_id')}
        ON CONFLICT DO NOTHING`,
        [v.id, postId, c.id, 'comment:' + c.id],
      );
      await em.query(
        "INSERT INTO community_actions(user_id,post_id,kind) VALUES($1,$2,'subscription') ON CONFLICT DO NOTHING",
        [v.id, postId],
      );
      return { id: c.id };
    });
  }

  async editComment(v: CommunityViewer, id: string, body?: string) {
    if (body !== undefined) this.writable(v);
    else this.enabled(v);
    if (body !== undefined && !body.trim())
      throw new BadRequestException('Vui lòng nhập bình luận.');
    return this.db.transaction(async (em) => {
      const [ref] = await em.query(
        'SELECT post_id FROM community_comments WHERE id=$1 AND author_id=$2',
        [id, v.id],
      );
      if (!ref) throw new NotFoundException();
      await this.lockPost(em, v, ref.post_id);
      const rows = await em.query(
        `UPDATE community_comments SET ${body === undefined ? "state='deleted'" : 'body=$3'},updated_at=now() WHERE id=$1 AND author_id=$2 AND state='published' RETURNING id`,
        body === undefined ? [id, v.id] : [id, v.id, body.trim()],
      );
      if (!rows.length) throw new NotFoundException();
      if (body === undefined)
        await em.query(
          'UPDATE community_posts SET helpful_comment_id=NULL WHERE helpful_comment_id=$1',
          [id],
        );
      return { id };
    });
  }

  async helpful(
    v: CommunityViewer,
    postId: string,
    commentId: string,
    enabled: boolean,
  ) {
    this.writable(v);
    return this.db.transaction(async (em) => {
      const p = await this.lockPost(em, v, postId);
      if (p.author_id !== v.id || p.kind !== 'question')
        throw new ForbiddenException(
          'Chỉ tác giả câu hỏi được chọn câu trả lời hữu ích.',
        );
      const [comment] = await em.query(
        `SELECT c.id FROM community_comments c WHERE c.id=$2 AND c.post_id=$3 AND c.state='published' AND NOT ${blocked('c.author_id')}`,
        [v.id, commentId, postId],
      );
      if (!comment) throw new NotFoundException();
      await em.query(
        'UPDATE community_posts SET helpful_comment_id=$2 WHERE id=$1',
        [postId, enabled ? commentId : null],
      );
      return { enabled };
    });
  }

  async upload(v: CommunityViewer, file?: Express.Multer.File) {
    this.writable(v);
    if (!file || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Ảnh tối đa 5 MB.');
    await this.db.query(
      "DELETE FROM community_media WHERE post_id IS NULL AND created_at<now()-interval '24 hours'",
    );
    let bytes: Buffer;
    try {
      const input = sharp(file.buffer, {
        limitInputPixels: 24_000_000,
        animated: false,
      });
      const metadata = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format || ''))
        throw new Error();
      // Re-encode; metadata including EXIF/GPS is removed by default.
      bytes = await input
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        'Ảnh không hợp lệ. Chọn JPG, PNG hoặc WebP tối đa 24 megapixel.',
      );
    }
    const [media] = await this.db.query(
      'INSERT INTO community_media(owner_id,bytes) VALUES($1,$2) RETURNING id',
      [v.id, bytes],
    );
    return media;
  }
  async media(v: CommunityViewer, id: string) {
    this.enabled(v);
    const [m] = await this.db.query(
      `SELECT m.bytes,m.mime FROM community_media m LEFT JOIN community_posts p ON p.id=m.post_id
      WHERE m.id=$2 AND ((m.post_id IS NULL AND m.owner_id=$1) OR (${visible()}) OR (p.state='draft' AND p.author_id=$1) OR ($3::boolean AND p.state='hidden'))`,
      [v.id, id, !!v.platformRole],
    );
    if (!m) throw new NotFoundException();
    return m;
  }

  async profile(v: CommunityViewer, id: string) {
    this.enabled(v);
    const [p] = await this.db.query(
      `SELECT u.id,COALESCE(cp.display_name,u."fullName") AS name,u.role,
      COALESCE(cp.bio,'') bio,COALESCE(cp.region,'') region,COALESCE(cp.crops,'') crops,
      cp.province_code AS "provinceCode",cp.commune_code AS "communeCode"
      FROM users u LEFT JOIN community_profiles cp ON cp.user_id=u.id WHERE u.id=$2 AND u."isActive" AND NOT ${blocked('u.id')}`,
      [v.id, id],
    );
    if (!p) throw new NotFoundException();
    return p;
  }
  async updateProfile(v: CommunityViewer, dto: ProfileDto) {
    this.writable(v);
    if (dto.displayName.trim().length < 2)
      throw new BadRequestException('Tên hiển thị tối thiểu 2 ký tự.');
    const changingLocation = dto.provinceCode !== undefined || dto.communeCode !== undefined;
    let location: { provinceCode: string | null; communeCode: string | null } | null = null;
    if (changingLocation) {
      const [current] = await this.db.query(
        'SELECT province_code,commune_code FROM community_profiles WHERE user_id=$1', [v.id],
      );
      location = await validateLocation(this.db, {
        provinceCode: current?.province_code ?? null,
        communeCode: current?.commune_code ?? null,
      }, dto);
    }
    await this.db.query(
      `INSERT INTO community_profiles(user_id,display_name,bio,region,crops,province_code,commune_code)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,bio=excluded.bio,
      region=excluded.region,crops=excluded.crops,
      province_code=CASE WHEN $8::boolean THEN excluded.province_code ELSE community_profiles.province_code END,
      commune_code=CASE WHEN $8::boolean THEN excluded.commune_code ELSE community_profiles.commune_code END`,
      [
        v.id,
        dto.displayName.trim(),
        dto.bio.trim(),
        dto.region.trim(),
        dto.crops.trim(),
        location?.provinceCode ?? null,
        location?.communeCode ?? null,
        changingLocation,
      ],
    );
    return this.profile(v, v.id);
  }
  async business(v: CommunityViewer, id: string) {
    this.enabled(v);
    const [o] = await this.db.query(
      `SELECT o.id,o.name,o.bio,o.region,
        EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=o.id AND d.status='verified') AS verified
       FROM agrilink_organizations o WHERE o.id=$1 AND o.community_enabled`,
      [id],
    );
    if (!o) throw new NotFoundException();
    return o;
  }
  async updateBusiness(v: CommunityViewer, id: string, dto: OrganizationDto) {
    this.writable(v);
    if (v.role !== 'owner' || !v.memberships.some((m) => m.id === id))
      throw new ForbiddenException();
    await this.db.query(
      'UPDATE agrilink_organizations SET name=$2,bio=$3,region=$4 WHERE id=$1',
      [id, dto.name.trim(), dto.bio.trim(), dto.region.trim()],
    );
    return this.business(v, id);
  }

  async blocks(v: CommunityViewer) {
    return this.db.query(
      `SELECT u.id,COALESCE(cp.display_name,u."fullName") AS name FROM community_blocks b JOIN users u ON u.id=b.blocked_id LEFT JOIN community_profiles cp ON cp.user_id=u.id WHERE b.blocker_id=$1 ORDER BY name`,
      [v.id],
    );
  }
  async block(v: CommunityViewer, id: string, enabled: boolean) {
    this.enabled(v);
    if (id === v.id)
      throw new BadRequestException('Không thể chặn chính mình.');
    if (enabled) {
      const [u] = await this.db.query('SELECT id FROM users WHERE id=$1', [id]);
      if (!u) throw new NotFoundException();
      await this.db.query(
        'INSERT INTO community_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [v.id, id],
      );
    } else
      await this.db.query(
        'DELETE FROM community_blocks WHERE blocker_id=$1 AND blocked_id=$2',
        [v.id, id],
      );
    return { enabled };
  }

  async report(v: CommunityViewer, dto: ReportDto) {
    this.enabled(v);
    let postId = dto.targetId;
    if (dto.targetType === 'comment') {
      const [c] = await this.db.query(
        `SELECT c.post_id FROM community_comments c WHERE c.id=$2 AND c.state='published' AND NOT ${blocked('c.author_id')}`,
        [v.id, dto.targetId],
      );
      if (!c) throw new NotFoundException();
      postId = c.post_id;
    }
    await this.post(v, postId);
    const commentId = dto.targetType === 'comment' ? dto.targetId : null;
    const inserted = await this.db.query(
      `INSERT INTO community_reports(reporter_id,post_id,comment_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [v.id, postId, commentId, dto.reason.trim()],
    );
    const [report] = inserted.length
      ? inserted
      : await this.db.query(
          `SELECT id FROM community_reports WHERE reporter_id=$1 AND post_id=$2 AND COALESCE(comment_id,post_id)=COALESCE($3::uuid,$2) AND state='open'`,
          [v.id, postId, commentId],
        );
    return {
      id: report.id,
      message: 'Báo cáo đã được gửi đến người quản trị.',
    };
  }

  private notificationVisibility() {
    return `n.recipient_id=$1 AND (n.kind IN ('moderation','agrilink_order','agrilink_lead','agrilink_offer','agrilink_offer_status','agrilink_price_reminder','agrilink_rate','agrilink_verification','agrilink_complaint','agrilink_support') OR (
      ${visible()} AND NOT ${blocked('n.actor_id')} AND
      (n.comment_id IS NULL OR EXISTS(SELECT 1 FROM community_comments c WHERE c.id=n.comment_id AND c.state='published' AND (c.parent_id IS NULL OR EXISTS(SELECT 1 FROM community_comments par WHERE par.id=c.parent_id AND par.state='published' AND NOT ${blocked('par.author_id')}))))))`;
  }
  async notifications(v: CommunityViewer) {
    this.enabled(v);
    const rows: (NotificationRow & Record<string, unknown>)[] = await this.db.query(
      `SELECT n.id,n.kind,n.post_id AS "postId",n.read_at AS "readAt",n.created_at AS "createdAt",n.event_key AS "eventKey",
       CASE WHEN n.kind='moderation' THEN 'Quản trị cộng đồng' WHEN n.kind='agrilink_lead' THEN 'Nguồn hàng AgriLink' WHEN n.kind IN ('agrilink_offer_status','agrilink_price_reminder','agrilink_rate','agrilink_verification','agrilink_complaint','agrilink_support') THEN 'AgriLink' ELSE COALESCE(cp.display_name,u."fullName") END AS "actorName",
       o.id AS "orderId",o.code AS "orderCode",o."requesterId" AS "orderRequesterId",
       io.intent_id AS "offerIntentId",dv.status AS "verificationStatus"
      FROM community_notifications n JOIN users u ON u.id=n.actor_id LEFT JOIN community_profiles cp ON cp.user_id=u.id
      LEFT JOIN community_posts p ON p.id=n.post_id
      LEFT JOIN agrilink_orders o ON n.kind IN ('agrilink_order','agrilink_rate') AND o.id=${KEY_UUID}
      LEFT JOIN agrilink_intent_offers io ON n.kind='agrilink_offer' AND io.id=${KEY_UUID}
      LEFT JOIN agrilink_dealer_verifications dv ON n.kind='agrilink_verification' AND dv.organization_id=${KEY_UUID}
      WHERE ${this.notificationVisibility()} ORDER BY n.created_at DESC,n.id DESC LIMIT 40`,
      [v.id],
    );
    const items = rows.map(
      ({ eventKey, orderId, orderCode, orderRequesterId, offerIntentId, verificationStatus, ...item }) => ({
        ...item,
        ...describeNotification(
          { kind: item.kind, postId: item.postId, eventKey, orderId, orderCode, orderRequesterId, offerIntentId, verificationStatus },
          v.id,
        ),
      }),
    );
    const [count] = await this.db.query(
      `SELECT count(*)::int AS total FROM community_notifications n LEFT JOIN community_posts p ON p.id=n.post_id WHERE ${this.notificationVisibility()} AND n.read_at IS NULL`,
      [v.id],
    );
    return { items, unread: count.total };
  }
  async readNotification(v: CommunityViewer, id?: string) {
    this.enabled(v);
    await this.db.query(
      `UPDATE community_notifications SET read_at=now() WHERE recipient_id=$1 AND read_at IS NULL ${id ? 'AND id=$2' : ''}`,
      id ? [v.id, id] : [v.id],
    );
    return { read: true };
  }

  async reports(v: CommunityViewer, state: string) {
    this.moderator(v);
    return this.db.query(
      `SELECT r.id,r.reason,r.state,r.post_id AS "postId",r.comment_id AS "commentId",r.created_at AS "createdAt",
      COALESCE(c.body,p.body) AS content,COALESCE(c.state,p.state) AS "contentState",COALESCE(c.author_id,p.author_id) AS "authorId",
      cp.suspended,COALESCE(cp.display_name,u."fullName") AS "authorName",
      COALESCE((SELECT json_agg(json_build_object('action',ma.action,'reason',ma.reason,'at',ma.created_at) ORDER BY ma.created_at DESC) FROM community_moderation_actions ma WHERE ma.report_id=r.id),'[]'::json) AS history
      FROM community_reports r JOIN community_posts p ON p.id=r.post_id LEFT JOIN community_comments c ON c.id=r.comment_id
      JOIN users u ON u.id=COALESCE(c.author_id,p.author_id) LEFT JOIN community_profiles cp ON cp.user_id=u.id
      WHERE r.state=$1 ORDER BY r.created_at DESC LIMIT 100`,
      [state === 'resolved' ? 'resolved' : 'open'],
    );
  }
  async moderate(v: CommunityViewer, id: string, dto: ModerationDto) {
    this.moderator(v);
    return this.db.transaction(async (em) => {
      const [r] = await em.query(
        'SELECT * FROM community_reports WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!r) throw new NotFoundException();
      if (r.state !== 'open')
        throw new BadRequestException('Báo cáo này đã được xử lý.');
      const table = r.comment_id ? 'community_comments' : 'community_posts';
      const target = r.comment_id || r.post_id;
      const [p] = await em.query(
        `SELECT author_id,state FROM ${table} WHERE id=$1 FOR UPDATE`,
        [target],
      );
      if (!p) throw new NotFoundException('Nội dung không còn tồn tại.');
      if (dto.action === 'hide' || dto.action === 'restore') {
        if (p.state === 'deleted')
          throw new BadRequestException('Nội dung đã được tác giả xóa.');
        await em.query(
          `UPDATE ${table} SET state=$2,updated_at=now() WHERE id=$1`,
          [target, dto.action === 'hide' ? 'hidden' : 'published'],
        );
        if (!r.comment_id)
          await em.query(
            'UPDATE community_posts SET moderation_reason=$2 WHERE id=$1',
            [target, dto.reason],
          );
      }
      if (dto.action === 'suspend' || dto.action === 'unsuspend') {
        const [privileged] = await em.query(
          'SELECT role FROM agrilink_platform_roles WHERE user_id=$1',
          [p.author_id],
        );
        if (privileged)
          throw new ForbiddenException(
            'Không thể khóa tài khoản quản trị qua báo cáo.',
          );
        await em.query(
          `INSERT INTO community_profiles(user_id,display_name,suspended) SELECT id,left("fullName",100),$2 FROM users WHERE id=$1
          ON CONFLICT(user_id) DO UPDATE SET suspended=excluded.suspended`,
          [p.author_id, dto.action === 'suspend'],
        );
      }
      const [action] = await em.query(
        'INSERT INTO community_moderation_actions(report_id,actor_id,action,reason) VALUES($1,$2,$3,$4) RETURNING id',
        [id, v.id, dto.action, dto.reason.trim()],
      );
      await em.query(
        "UPDATE community_reports SET state='resolved',resolved_at=now() WHERE id=$1",
        [id],
      );
      for (const recipient of new Set<string>([p.author_id, r.reporter_id])) {
        await em.query(
          `INSERT INTO community_notifications(recipient_id,actor_id,post_id,kind,event_key) VALUES($1,$2,$3,'moderation',$4) ON CONFLICT DO NOTHING`,
          [recipient, v.id, r.post_id, 'moderation:' + action.id],
        );
      }
      return { id, action: dto.action };
    });
  }

  async organizations(v: CommunityViewer) {
    this.admin(v);
    return this.db
      .query(`SELECT o.id,o.name,o.bio,o.region,o.community_enabled AS "communityEnabled",
      (SELECT count(*)::int FROM agrilink_memberships m WHERE m.organization_id=o.id AND m.active) AS members FROM agrilink_organizations o ORDER BY o.name`);
  }
  async createOrganization(v: CommunityViewer, dto: OrganizationDto) {
    this.admin(v);
    return this.db.transaction(async (em) => {
      if (!dto.ownerId)
        throw new BadRequestException('Cần tài khoản chủ doanh nghiệp.');
      const [owner] = await em.query(
        'SELECT id,role,"organizationId" FROM users WHERE id=$1 AND "isActive" FOR UPDATE',
        [dto.ownerId],
      );
      if (!owner || owner.role !== 'owner' || owner.organizationId)
        throw new BadRequestException(
          'Chủ doanh nghiệp phải là tài khoản owner chưa được gán doanh nghiệp.',
        );
      const [o] = await em.query(
        'INSERT INTO agrilink_organizations(name,bio,region) VALUES($1,$2,$3) RETURNING id',
        [dto.name.trim(), dto.bio.trim(), dto.region.trim()],
      );
      await em.query('UPDATE users SET "organizationId"=$2 WHERE id=$1', [
        owner.id,
        o.id,
      ]);
      await em.query(
        'INSERT INTO agrilink_memberships(user_id,organization_id,can_publish) VALUES($1,$2,true)',
        [owner.id, o.id],
      );
      return o;
    });
  }
  async module(v: CommunityViewer, id: string, enabled: boolean) {
    this.admin(v);
    const rows = await this.db.query(
      'UPDATE agrilink_organizations SET community_enabled=$2 WHERE id=$1 RETURNING id',
      [id, enabled],
    );
    if (!rows.length) throw new NotFoundException();
    return rows[0];
  }
  async members(v: CommunityViewer, id: string) {
    if (
      !v.platformRole &&
      !(v.role === 'owner' && v.memberships.some((m) => m.id === id))
    )
      throw new ForbiddenException();
    return this.db.query(
      `SELECT u.id,u."fullName" AS name,u.role,m.can_publish AS "canPublish",m.active FROM agrilink_memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u."fullName"`,
      [id],
    );
  }
  async membership(
    v: CommunityViewer,
    org: string,
    user: string,
    active: boolean,
    canPublish: boolean,
  ) {
    if (
      v.platformRole !== 'admin' &&
      !(v.role === 'owner' && v.memberships.some((m) => m.id === org))
    )
      throw new ForbiddenException();
    const [target] = await this.db.query('SELECT role FROM users WHERE id=$1', [
      user,
    ]);
    if (!target || target.role === 'owner')
      throw new BadRequestException(
        'Không thay đổi quyền chủ doanh nghiệp tại đây.',
      );
    const rows = await this.db.query(
      'UPDATE agrilink_memberships SET active=$3,can_publish=$4 WHERE organization_id=$1 AND user_id=$2 RETURNING user_id',
      [org, user, active, canPublish],
    );
    if (!rows.length) throw new NotFoundException();
    return { active, canPublish };
  }
}
