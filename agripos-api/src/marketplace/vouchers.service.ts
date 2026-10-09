import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CommunityViewer } from '../community/community.service';
import { managerOrganization } from './manage-access';
import { VOUCHER_COLUMNS, voucherFields } from './voucher-order';
import { validateVoucher, voucherState, voucherUnusableReason, type VoucherInput } from './voucher-rules';

const V_COLUMNS = VOUCHER_COLUMNS.split(',').map((c) => `v.${c}`).join(',');

const managed = (r: any) => {
  const f = voucherFields(r);
  return {
    id: r.id as string,
    ...f,
    state: voucherState(f, new Date()),
    savedCount: Number(r.saved_count ?? 0),
    // Đã gắn với đơn nào (kể cả đơn huỷ) thì không xoá được, chỉ dừng.
    hasOrders: !!r.has_orders,
  };
};

/** Voucher của đại lý: đại lý quản lý, nông dân lưu ở gian hàng. */
@Injectable()
export class VouchersService {
  constructor(private readonly db: DataSource) {}

  async list(v: CommunityViewer) {
    const org = managerOrganization(v);
    const rows = await this.db.query(
      `SELECT ${V_COLUMNS},v.created_at,
         (SELECT count(*)::int FROM agrilink_voucher_claims c WHERE c.voucher_id=v.id) AS saved_count,
         EXISTS(SELECT 1 FROM agrilink_orders a WHERE a."voucherId"=v.id) AS has_orders
       FROM agrilink_vouchers v WHERE v.organization_id=$1 ORDER BY v.created_at DESC LIMIT 200`,
      [org],
    );
    const [stats] = await this.db.query(
      `SELECT count(*)::int AS used, COALESCE(sum(a."discountAmount"),0)::float AS discounted
       FROM agrilink_orders a
       WHERE a."organizationId"=$1 AND a."voucherId" IS NOT NULL AND a.status NOT IN ('cancelled','rejected')
         AND a."createdAt" > now()-interval '30 days'`,
      [org],
    );
    const items = (rows as any[]).map(managed);
    return {
      items,
      stats: {
        running: items.filter((i) => i.state === 'running').length,
        used30d: stats?.used ?? 0,
        discount30d: stats?.discounted ?? 0,
      },
    };
  }

  async create(v: CommunityViewer, dto: VoucherInput) {
    const org = managerOrganization(v);
    const f = validateVoucher(dto, new Date());
    const [row] = await this.db.query(
      `INSERT INTO agrilink_vouchers(organization_id,title,discount_type,value,max_discount,min_order,quantity,starts_at,ends_at,active,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${VOUCHER_COLUMNS}`,
      [org, f.title, f.type, f.value, f.maxDiscount, f.minOrder, f.quantity, f.startsAt, f.endsAt, f.active, v.id],
    );
    return managed(row);
  }

  async update(v: CommunityViewer, id: string, dto: VoucherInput) {
    const org = managerOrganization(v);
    return this.db.transaction(async (em) => {
      const [current] = await em.query(
        `SELECT ${VOUCHER_COLUMNS} FROM agrilink_vouchers WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, org],
      );
      if (!current) throw new NotFoundException('Không tìm thấy voucher.');
      const f = validateVoucher(dto, new Date(), voucherFields(current));
      const [row] = await em.query(
        `UPDATE agrilink_vouchers SET title=$3,discount_type=$4,value=$5,max_discount=$6,min_order=$7,quantity=$8,
           starts_at=$9,ends_at=$10,active=$11,updated_at=now()
         WHERE id=$1 AND organization_id=$2 RETURNING ${VOUCHER_COLUMNS}`,
        [id, org, f.title, f.type, f.value, f.maxDiscount, f.minOrder, f.quantity, f.startsAt, f.endsAt, f.active],
      );
      return managed(row);
    });
  }

  async remove(v: CommunityViewer, id: string) {
    const org = managerOrganization(v);
    await this.db.transaction(async (em) => {
      const [current] = await em.query(
        `SELECT id,used_count FROM agrilink_vouchers WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, org],
      );
      if (!current) throw new NotFoundException('Không tìm thấy voucher.');
      // Đơn đã huỷ vẫn giữ tham chiếu voucher để xem lại lịch sử.
      const [ref] = await em.query(
        `SELECT EXISTS(SELECT 1 FROM agrilink_orders WHERE "voucherId"=$1) AS used`,
        [id],
      );
      if (Number(current.used_count) > 0 || ref?.used)
        throw new BadRequestException('Voucher đã có người dùng — hãy dừng voucher thay vì xoá.');
      await em.query(`DELETE FROM agrilink_vouchers WHERE id=$1 AND organization_id=$2`, [id, org]);
    });
    return { id };
  }

  async save(v: CommunityViewer, id: string) {
    if (v.suspended) throw new ForbiddenException('Tài khoản đang bị tạm khóa.');
    const [row] = await this.db.query(
      `SELECT ${V_COLUMNS},v.organization_id,o.marketplace_enabled
       FROM agrilink_vouchers v JOIN agrilink_organizations o ON o.id=v.organization_id WHERE v.id=$1`,
      [id],
    );
    if (!row || !row.marketplace_enabled) throw new NotFoundException('Không tìm thấy voucher.');
    if (v.memberships.some((m) => m.id === row.organization_id))
      throw new BadRequestException('Không thể lưu voucher của đại lý mình.');
    const f = voucherFields(row);
    const now = new Date();
    // Lưu trước được voucher sắp diễn ra; các lý do khác chặn việc lưu.
    const state = voucherState(f, now);
    if (state !== 'running' && state !== 'scheduled')
      throw new BadRequestException(voucherUnusableReason(f, { now, subtotal: Infinity, usedByMe: false })!);
    await this.db.query(
      `INSERT INTO agrilink_voucher_claims(voucher_id,user_id,organization_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [id, v.id, row.organization_id],
    );
    return { saved: true };
  }

  /** Voucher hiện ở gian hàng: đang chạy hoặc bắt đầu trong 7 ngày tới. */
  async forStorefront(dealerId: string, userId: string) {
    const rows = await this.db.query(
      `SELECT ${V_COLUMNS},
         c.user_id IS NOT NULL AS saved, c.order_id IS NOT NULL AS used_by_me
       FROM agrilink_vouchers v
       LEFT JOIN agrilink_voucher_claims c ON c.voucher_id=v.id AND c.user_id=$2
       WHERE v.organization_id=$1 AND v.active AND v.ends_at > now() AND v.starts_at <= now()+interval '7 days'
       ORDER BY v.ends_at LIMIT 20`,
      [dealerId, userId],
    );
    return rows.map((r: any) => {
      const f = voucherFields(r);
      return {
        id: r.id as string,
        title: f.title,
        type: f.type,
        value: f.value,
        maxDiscount: f.maxDiscount,
        minOrder: f.minOrder,
        startsAt: f.startsAt,
        endsAt: f.endsAt,
        remaining: Math.max(0, f.quantity - f.usedCount),
        saved: !!r.saved,
        usedByMe: !!r.used_by_me,
      };
    });
  }
}
