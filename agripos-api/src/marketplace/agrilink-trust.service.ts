import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  CommunityService,
  CommunityViewer,
} from '../community/community.service';
import {
  BUY_OFFER_REMIND_HOURS,
  BUY_OFFER_STALE_HOURS,
  vnDay,
} from './trust-pricing';
import { RatingDto, VerificationDto } from './agrilink-trust.dto';

export const ratingAggregateSql = `SELECT
  round(avg(stars)::numeric,1)::float AS "avgStars",count(*)::int AS count,
  round(100.0*count(*) FILTER (WHERE accurate_weight=true)/NULLIF(count(*) FILTER (WHERE accurate_weight IS NOT NULL),0))::int AS "accurateWeightPct",
  round(100.0*count(*) FILTER (WHERE paid_on_time=true)/NULLIF(count(*) FILTER (WHERE paid_on_time IS NOT NULL),0))::int AS "paidOnTimePct",
  round(100.0*count(*) FILTER (WHERE on_time=true)/NULLIF(count(*) FILTER (WHERE on_time IS NOT NULL),0))::int AS "onTimePct",
  round(100.0*count(*) FILTER (WHERE as_described=true)/NULLIF(count(*) FILTER (WHERE as_described IS NOT NULL),0))::int AS "asDescribedPct"
  FROM agrilink_order_ratings WHERE organization_id=$1 AND NOT hidden`;

@Injectable()
export class AgrilinkTrustService {
  constructor(
    private readonly db: DataSource,
    private readonly community: CommunityService,
  ) {}
  private org(v: CommunityViewer, owner = false) {
    if (
      !v.organizationId ||
      !v.memberships.some((m) => m.id === v.organizationId) ||
      (owner ? v.role !== 'owner' : !['owner', 'manager'].includes(v.role))
    )
      throw new ForbiddenException(
        owner
          ? 'Chỉ chủ đại lý được gửi xác minh.'
          : 'Cần quyền quản lý đại lý.',
      );
    return v.organizationId;
  }
  aggregates(orgId: string) {
    return this.db.query(ratingAggregateSql, [orgId]).then((rows) => rows[0]);
  }
  async aggregatesFor(orgIds: string[]) {
    return new Map(
      await Promise.all(
        [...new Set(orgIds)].map(
          async (id) => [id, await this.aggregates(id)] as const,
        ),
      ),
    );
  }
  async ownRating(userId: string, orderId: string) {
    const [r] = await this.db.query(
      `SELECT stars,accurate_weight AS "accurateWeight",paid_on_time AS "paidOnTime",on_time AS "onTime",as_described AS "asDescribed",comment,created_at AS "createdAt" FROM agrilink_order_ratings WHERE order_id=$1 AND rater_id=$2`,
      [orderId, userId],
    );
    return r ?? null;
  }
  async rate(v: CommunityViewer, orderId: string, dto: RatingDto) {
    return this.db.transaction(async (em) => {
      const [o] = await em.query(
        `SELECT id,"organizationId" AS org,"requesterId" AS requester,kind,status,"completedAt" AS completed FROM agrilink_orders WHERE id=$1 AND "requesterId"=$2 FOR UPDATE`,
        [orderId, v.id],
      );
      if (!o) throw new NotFoundException('Không tìm thấy đơn.');
      if (
        o.status !== 'completed' ||
        !o.completed ||
        Date.now() - new Date(o.completed).getTime() > 14 * 86400000
      )
        throw new BadRequestException(
          'Đơn chưa hoàn thành hoặc đã quá 14 ngày.',
        );
      if (
        (o.kind === 'sell' && dto.asDescribed != null) ||
        (o.kind === 'buy' &&
          (dto.accurateWeight != null || dto.paidOnTime != null))
      )
        throw new BadRequestException(
          'Tiêu chí không áp dụng cho loại đơn này.',
        );
      try {
        await em.query(
          `INSERT INTO agrilink_order_ratings(order_id,organization_id,rater_id,stars,accurate_weight,paid_on_time,on_time,as_described,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            orderId,
            o.org,
            v.id,
            dto.stars,
            dto.accurateWeight ?? null,
            dto.paidOnTime ?? null,
            dto.onTime ?? null,
            dto.asDescribed ?? null,
            dto.comment?.trim() ?? '',
          ],
        );
      } catch (e: any) {
        if (e?.code === '23505')
          throw new ConflictException('Đơn đã được đánh giá.');
        throw e;
      }
      const [rating] = await em.query(
        `SELECT stars,accurate_weight AS "accurateWeight",paid_on_time AS "paidOnTime",on_time AS "onTime",as_described AS "asDescribed",comment,created_at AS "createdAt" FROM agrilink_order_ratings WHERE order_id=$1`,
        [orderId],
      );
      return rating;
    });
  }
  async publicRatings(orgId: string, page = 1) {
    const [org] = await this.db.query(
      'SELECT id FROM agrilink_organizations WHERE id=$1 AND marketplace_enabled',
      [orgId],
    );
    if (!org) throw new NotFoundException('Không tìm thấy đại lý.');
    const items = await this.db.query(
      `SELECT r.stars,json_build_object('accurateWeight',r.accurate_weight,'paidOnTime',r.paid_on_time,'onTime',r.on_time,'asDescribed',r.as_described) AS tags,r.comment,r.created_at AS "createdAt",
      'Nông dân ở ' || COALESCE(p.name,'AgriLink') AS "raterLabel"
      FROM agrilink_order_ratings r JOIN agrilink_orders o ON o.id=r.order_id
      LEFT JOIN agrilink_intents i ON i.id=o."intentId"
      LEFT JOIN community_profiles cp ON cp.user_id=r.rater_id
      LEFT JOIN admin_provinces p ON p.code=COALESCE(i.province_code,cp.province_code)
      WHERE r.organization_id=$1 AND NOT r.hidden ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET $2`,
      [orgId, (page - 1) * 20],
    );
    return { items, aggregates: await this.aggregates(orgId) };
  }
  async manageRatings(v: CommunityViewer, page = 1) {
    const org = this.org(v);
    const items = await this.db.query(
      `SELECT r.id,r.order_id AS "orderId",r.stars,json_build_object('accurateWeight',r.accurate_weight,'paidOnTime',r.paid_on_time,'onTime',r.on_time,'asDescribed',r.as_described) AS tags,r.comment,r.hidden,r.hidden_reason AS "hiddenReason",r.created_at AS "createdAt" FROM agrilink_order_ratings r WHERE r.organization_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET $2`,
      [org, (page - 1) * 20],
    );
    return { items, aggregates: await this.aggregates(org) };
  }
  async hide(v: CommunityViewer, id: string, reason?: string) {
    this.community.moderator(v);
    if (!reason?.trim() || reason.trim().length > 200)
      throw new BadRequestException('Cần lý do tối đa 200 ký tự.');
    const [r] = await this.db.query(
      'UPDATE agrilink_order_ratings SET hidden=true,hidden_reason=$2 WHERE id=$1 RETURNING id,hidden',
      [id, reason.trim()],
    );
    if (!r) throw new NotFoundException();
    return r;
  }
  async unhide(v: CommunityViewer, id: string) {
    this.community.moderator(v);
    const [r] = await this.db.query(
      'UPDATE agrilink_order_ratings SET hidden=false,hidden_reason=NULL WHERE id=$1 RETURNING id,hidden',
      [id],
    );
    if (!r) throw new NotFoundException();
    return r;
  }
  async verification(v: CommunityViewer) {
    const org = this.org(v, true);
    const [row] = await this.db.query(
      `SELECT status,legal_name AS "legalName",tax_code AS "taxCode",business_address AS "businessAddress",submitted_at AS "submittedAt",reviewed_at AS "reviewedAt",note FROM agrilink_dealer_verifications WHERE organization_id=$1`,
      [org],
    );
    return row ?? null;
  }
  async submit(v: CommunityViewer, dto: VerificationDto) {
    const org = this.org(v, true);
    if (
      !/^\d{10}(?:-\d{3})?$/.test(dto.taxCode) ||
      !dto.legalName?.trim() ||
      !dto.businessAddress?.trim()
    )
      throw new BadRequestException('Thông tin xác minh không hợp lệ.');
    const [row] = await this.db.query(
      `INSERT INTO agrilink_dealer_verifications(organization_id,legal_name,tax_code,business_address,submitted_by) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(organization_id) DO UPDATE SET status='pending',legal_name=excluded.legal_name,tax_code=excluded.tax_code,business_address=excluded.business_address,submitted_by=excluded.submitted_by,submitted_at=now(),reviewed_by=NULL,reviewed_at=NULL,note=''
      WHERE agrilink_dealer_verifications.status='rejected' RETURNING status`,
      [
        org,
        dto.legalName.trim(),
        dto.taxCode,
        dto.businessAddress.trim(),
        v.id,
      ],
    );
    if (!row)
      throw new ConflictException('Hồ sơ đang chờ duyệt hoặc đã xác minh.');
    return this.verification(v);
  }
  async verifications(v: CommunityViewer, status?: string) {
    this.community.admin(v);
    if (status && !['pending', 'verified', 'rejected'].includes(status))
      throw new BadRequestException('Trạng thái không hợp lệ.');
    return this.db.query(
      `SELECT d.organization_id AS "organizationId",o.name AS "organizationName",p.name AS "provinceName",d.status,d.legal_name AS "legalName",d.tax_code AS "taxCode",d.business_address AS "businessAddress",d.submitted_at AS "submittedAt",d.reviewed_at AS "reviewedAt",d.note FROM agrilink_dealer_verifications d JOIN agrilink_organizations o ON o.id=d.organization_id LEFT JOIN admin_provinces p ON p.code=o.province_code WHERE ($1::text IS NULL OR d.status=$1) ORDER BY d.submitted_at DESC`,
      [status ?? null],
    );
  }
  async decide(
    v: CommunityViewer,
    orgId: string,
    action: 'approve' | 'reject' | 'revoke',
    note?: string,
  ) {
    this.community.admin(v);
    if (action !== 'approve' && !note?.trim())
      throw new BadRequestException('Cần ghi chú.');
    const from = action === 'revoke' ? 'verified' : 'pending';
    const to = action === 'approve' ? 'verified' : 'rejected';
    const [row] = await this.db.query(
      `UPDATE agrilink_dealer_verifications SET status=$3,reviewed_by=$4,reviewed_at=now(),note=$5 WHERE organization_id=$1 AND status=$2 RETURNING organization_id,status`,
      [orgId, from, to, v.id, note?.trim() ?? ''],
    );
    if (!row) throw new ConflictException('Trạng thái hồ sơ không phù hợp.');
    await this.db.query(
      `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key) SELECT m.user_id,$2,'agrilink_verification',$3 FROM agrilink_memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active AND u.role='owner' ON CONFLICT DO NOTHING`,
      [orgId, v.id, `agrilink-verification:${orgId}:${Date.now()}`],
    );
    return row;
  }
  @Cron('0 * * * *')
  async remindPrices() {
    const day = vnDay();
    await this.db.query(
      `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key)
      SELECT m.user_id,m.user_id,'agrilink_price_reminder','agrilink-price:' || f.id || ':' || $1
      FROM agrilink_offers f JOIN agrilink_memberships m ON m.organization_id=f.organization_id AND m.active
      JOIN users u ON u.id=m.user_id AND u.role IN ('owner','manager','cashier')
      WHERE f.kind='buy' AND f.active AND f.price_updated_at <= now()-($2::int * interval '1 hour')
        AND f.price_updated_at > now()-($3::int * interval '1 hour') ON CONFLICT DO NOTHING`,
      [day, BUY_OFFER_REMIND_HOURS, BUY_OFFER_STALE_HOURS],
    );
  }
}
