import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  AgrilinkOrder,
  AgrilinkOrderStatus,
} from './entities/agrilink-order.entity';
import { AgrilinkOrderItem } from './entities/agrilink-order-item.entity';
import { AgrilinkOrderEvent } from './entities/agrilink-order-event.entity';
import { User } from '../users/entities/user.entity';
import { nextStatus } from './order-state';
import { notifyUsers } from './agrilink-notify';
import { postOrderStatusLine } from '../agrilink-messaging/order-thread';
import { releaseVoucher } from '../marketplace/voucher-order';
import { voucherDiscount } from '../marketplace/voucher-rules';
import { ListOrdersQuery, UpdateItemsDto } from './dto/manage.dto';

export type ManageUser = {
  userId: string;
  role: string;
  organizationId: string;
};
export type Party = { id: string; name: string; phone: string | null };
const STATUSES: AgrilinkOrderStatus[] = [
  'pending',
  'confirmed',
  'delivering',
  'completed',
  'rejected',
  'cancelled',
];
export const phoneKey = (p: string | null | undefined) =>
  (p ?? '').replace(/\D/g, '').slice(-9);
// agrilink_order_events.note is varchar(500); keep any generated note within that bound.
export const truncateNote = (s: string, max = 500) =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;
// Shallow-drops keys instead of destructuring-to-discard, which ESLint flags
// as unused variables for names kept only to exclude them from the rest.
export const omit = <T extends object>(
  obj: T,
  keys: (keyof T)[],
): Partial<T> => {
  const copy: Partial<T> = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
};

@Injectable()
export class AgrilinkOrdersService {
  constructor(private readonly dataSource: DataSource) {}

  async list(q: ListOrdersQuery) {
    const limit = q.limit ?? 20,
      offset = ((q.page ?? 1) - 1) * limit;
    const params = [q.status ?? null, q.kind ?? null, (q.q ?? '').trim()];
    const where = `($1::text IS NULL OR a.status=$1) AND ($2::text IS NULL OR a.kind=$2)
      AND ($3='' OR a.code ILIKE '%'||$3||'%' OR a."contactName" ILIKE '%'||$3||'%' OR a."contactPhone" ILIKE '%'||$3||'%')`;
    const items = await this.dataSource.query(
      `SELECT a.id,a.code,a.kind,a.status,a.fulfillment,a."contactName",a."contactPhone",
         a."estimatedTotal"::float AS "estimatedTotal",a."finalTotal"::float AS "finalTotal",a."discountAmount"::float AS "discountAmount",a."voucherSnapshot"->>'title' AS "voucherTitle",a."createdAt",
         (SELECT count(*)::int FROM agrilink_order_items i WHERE i."orderId"=a.id) AS "itemCount"
       FROM agrilink_orders a WHERE ${where} ORDER BY a."createdAt" DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM agrilink_orders a WHERE ${where}`,
      params,
    );
    const countRows = await this.dataSource.query(
      `SELECT status, count(*)::int AS n FROM agrilink_orders GROUP BY status`,
    );
    const counts = Object.fromEntries(
      STATUSES.map((s) => [
        s,
        countRows.find((r: any) => r.status === s)?.n ?? 0,
      ]),
    );
    return { items, total, counts };
  }

  async detail(id: string) {
    const order = await this.dataSource.getRepository(AgrilinkOrder).findOne({
      where: { id },
      relations: ['items'],
      order: { items: { itemName: 'ASC' } },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn.');
    const events = await this.dataSource
      .getRepository(AgrilinkOrderEvent)
      .find({ where: { orderId: id }, order: { createdAt: 'ASC' } });
    let posRef: {
      type: string;
      id: string;
      code: string;
      status: string;
    } | null = null;
    if (order.posRefType === 'order' && order.posRefId) {
      const [r] = await this.dataSource.query(
        `SELECT "orderCode" AS code, status FROM orders WHERE id=$1`,
        [order.posRefId],
      );
      posRef = {
        type: 'order',
        id: order.posRefId,
        code: r?.code ?? '',
        status: r?.status ?? 'deleted',
      };
    } else if (order.posRefType === 'weighing_slip' && order.posRefId) {
      const [r] = await this.dataSource.query(
        `SELECT "slipCode" AS code, "paymentStatus" AS status FROM weighing_slips WHERE id=$1`,
        [order.posRefId],
      );
      posRef = {
        type: 'weighing_slip',
        id: order.posRefId,
        code: r?.code ?? '',
        status: r?.status ?? 'deleted',
      };
    }
    const rest = omit(order, [
      'posRefType',
      'posRefId',
      'requesterId',
      'organizationId',
      'items',
      'voucherId',
      'voucherSnapshot',
    ]);
    const items = order.items.map((i) =>
      omit(i, ['organizationId', 'orderId']),
    );
    return {
      ...rest,
      voucherTitle: order.voucherSnapshot?.title ?? null,
      // Để hộp hoàn thành đơn tính lại tiền giảm theo số lượng chốt cuối.
      voucherRule: order.voucherSnapshot
        ? {
            type: order.voucherSnapshot.type,
            value: order.voucherSnapshot.value,
            maxDiscount: order.voucherSnapshot.maxDiscount,
          }
        : null,
      itemCount: items.length,
      items,
      events: events.map(
        ({ fromStatus, toStatus, actorName, note, createdAt }) => ({
          fromStatus,
          toStatus,
          actorName,
          note,
          createdAt,
        }),
      ),
      posRef,
    };
  }

  async match(
    id: string,
  ): Promise<{ linked: Party | null; suggestions: Party[] }> {
    const [order] = await this.dataSource.query(
      `SELECT id,kind,"contactPhone","requesterId" FROM agrilink_orders WHERE id=$1`,
      [id],
    );
    if (!order) throw new NotFoundException('Không tìm thấy đơn.');
    const table = order.kind === 'buy' ? 'customers' : 'farmers';
    const col = order.kind === 'buy' ? '"customerId"' : '"farmerId"';
    const [linked] = await this.dataSource.query(
      `SELECT t.id,t.name,t.phone FROM agrilink_customer_links l JOIN ${table} t ON t.id=l.${col} WHERE l."userId"=$1`,
      [order.requesterId],
    );
    const key = phoneKey(order.contactPhone);
    const suggestions =
      key.length < 8
        ? []
        : await this.dataSource.query(
            `SELECT id,name,phone FROM ${table} WHERE "isActive" AND right(regexp_replace(coalesce(phone,''),'\\D','','g'),9)=$1 ORDER BY name LIMIT 5`,
            [key],
          );
    return { linked: linked ?? null, suggestions };
  }

  async updateItems(id: string, dto: UpdateItemsDto, user: ManageUser) {
    await this.dataSource.transaction(async (m) => {
      const order = await this.lock(m, id);
      nextStatus(order, 'editItems', { side: 'dealer', role: user.role });
      const items = await m.find(AgrilinkOrderItem, { where: { orderId: id } });
      const byId = new Map(items.map((i) => [i.id, i]));
      const changes: string[] = [];
      for (const e of dto.items) {
        const it = byId.get(e.itemId);
        if (!it) throw new BadRequestException('Dòng hàng không thuộc đơn.');
        if (
          Number(it.quantity) !== e.quantity ||
          Number(it.unitPrice) !== e.unitPrice
        )
          changes.push(
            `${(it as any).itemName ?? 'Dòng'}: ${it.quantity}×${it.unitPrice} → ${e.quantity}×${e.unitPrice}`,
          );
        it.quantity = e.quantity;
        it.unitPrice = e.unitPrice;
        await m.save(AgrilinkOrderItem, it);
      }
      order.estimatedTotal = items.reduce(
        (s, i) => s + Math.round(Number(i.quantity) * Number(i.unitPrice)),
        0,
      );
      // Đại lý sửa đơn: tính lại tiền giảm theo voucher, không xét lại đơn tối thiểu.
      if (order.voucherSnapshot)
        order.discountAmount = voucherDiscount(order.voucherSnapshot, order.estimatedTotal);
      await m.save(AgrilinkOrder, order);
      if (changes.length)
        await this.recordEvent(
          m,
          order,
          order.status,
          order.status,
          user,
          `Sửa đơn: ${changes.join('; ')}`,
        );
    });
    return this.detail(id);
  }

  async transition(
    id: string,
    action: 'confirm' | 'reject' | 'deliver' | 'cancel',
    user: ManageUser,
    reason?: string,
  ) {
    await this.dataSource.transaction(async (m) => {
      const order = await this.lock(m, id);
      const from = order.status;
      const to = nextStatus(order, action, { side: 'dealer', role: user.role });
      order.status = to;
      if (action === 'confirm') order.confirmedAt = new Date();
      if (action === 'reject') order.rejectReason = reason ?? null;
      if (action === 'cancel') {
        order.cancelReason = reason ?? null;
        order.cancelledBy = 'dealer';
      }
      await m.save(AgrilinkOrder, order);
      if (to === 'rejected' || to === 'cancelled') {
        await m.query(`UPDATE agrilink_service_bookings SET status='cancelled' WHERE agrilink_order_id=$1 AND status='active'`, [id]);
        await releaseVoucher((sql, p) => m.query(sql, p), { id, voucherId: order.voucherId ?? null });
        if (order.intentId) {
          await m.query(`UPDATE agrilink_intents SET status=CASE WHEN window_end >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN 'open' ELSE 'expired' END,updated_at=now() WHERE id=$1 AND status='matched'`, [order.intentId]);
          await m.query(`UPDATE agrilink_intent_offers SET status='expired',updated_at=now() WHERE intent_id=$1 AND organization_id=$2 AND status='accepted'`, [order.intentId, order.organizationId]);
        }
      }
      await this.recordEvent(m, order, from, to, user, reason);
    });
    return this.detail(id);
  }

  async lock(m: EntityManager, id: string) {
    const order = await m.findOne(AgrilinkOrder, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn.');
    return order;
  }

  async stats(from: Date, to: Date) {
    const [r] = await this.dataSource.query(
      `SELECT
         count(*) FILTER (WHERE "createdAt" BETWEEN $1 AND $2)::int AS new_orders,
         count(*) FILTER (WHERE status='pending')::int AS pending,
         count(*) FILTER (WHERE status IN ('confirmed','delivering'))::int AS in_progress,
         count(*) FILTER (WHERE "createdAt" BETWEEN $1 AND $2 AND status IN ('confirmed','delivering','completed'))::int AS accepted,
         count(*) FILTER (WHERE "createdAt" BETWEEN $1 AND $2 AND (status IN ('confirmed','delivering','completed','rejected')
                           OR (status='cancelled' AND ("cancelledBy"='dealer' OR "confirmedAt" IS NOT NULL))))::int AS decided,
         COALESCE(SUM("finalTotal") FILTER (WHERE kind='buy' AND status='completed' AND "completedAt" BETWEEN $1 AND $2),0) AS buy_revenue,
         COALESCE((SELECT SUM(i."finalQuantity") FROM agrilink_order_items i JOIN agrilink_orders a2 ON a2.id=i."orderId"
                   WHERE a2.kind='sell' AND a2.status='completed' AND a2."completedAt" BETWEEN $1 AND $2),0) AS sell_kg,
         COALESCE(SUM("finalTotal") FILTER (WHERE kind='sell' AND status='completed' AND "completedAt" BETWEEN $1 AND $2),0) AS sell_amount
       FROM agrilink_orders`,
      [from, to],
    );
    return {
      newOrders: r.new_orders,
      pendingOrders: r.pending,
      inProgress: r.in_progress,
      acceptanceRate: r.decided
        ? Math.round((r.accepted / r.decided) * 10000) / 10000
        : null,
      completedBuyRevenue: Number(r.buy_revenue),
      completedSellKg: Number(r.sell_kg),
      completedSellAmount: Number(r.sell_amount),
    };
  }

  async recordEvent(
    m: EntityManager,
    order: AgrilinkOrder,
    from: string | null,
    to: string,
    user: ManageUser,
    note?: string,
  ): Promise<void> {
    const actor = await m.findOne(User, { where: { id: user.userId } });
    await m.save(
      AgrilinkOrderEvent,
      m.create(AgrilinkOrderEvent, {
        orderId: order.id,
        fromStatus: from,
        toStatus: to,
        actorId: user.userId,
        actorName: actor?.fullName ?? 'Đại lý',
        note: truncateNote(note ?? ''),
      }),
    );
    // notifyUsers dedupes on (recipient_id, event_key) where event_key embeds this
    // "status" token; a plain status change reuses the same key on purpose (avoid
    // re-notifying the same transition), but an item edit keeps from === to, so it
    // needs a per-call unique token or every edit after the first would be dropped.
    const notifyStatus = from === to ? `${to}:edit:${randomUUID()}` : to;
    await notifyUsers(
      (sql, p) => m.query(sql, p),
      [order.requesterId],
      user.userId,
      order.id,
      notifyStatus,
    );
    if (from !== to) await postOrderStatusLine((sql, p) => m.query(sql, p), order, to);
  }
}
