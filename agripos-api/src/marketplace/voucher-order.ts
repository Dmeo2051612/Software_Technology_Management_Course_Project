import { BadRequestException } from '@nestjs/common';
import {
  voucherDiscount,
  voucherUnusableReason,
  type VoucherFields,
  type VoucherSnapshot,
  type VoucherType,
} from './voucher-rules';

type Q = (sql: string, params: unknown[]) => Promise<any[]>;

export const VOUCHER_COLUMNS = `id,title,discount_type,value,max_discount,min_order,quantity,used_count,starts_at,ends_at,active`;

/** Hàng `agrilink_vouchers` (numeric trả về dạng chuỗi) → trường quy tắc. */
export function voucherFields(r: any): VoucherFields {
  return {
    title: r.title,
    type: r.discount_type as VoucherType,
    value: Number(r.value),
    maxDiscount: r.max_discount == null ? null : Number(r.max_discount),
    minOrder: Number(r.min_order),
    quantity: Number(r.quantity),
    usedCount: Number(r.used_count),
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    active: r.active,
  };
}

export interface ReservedVoucher {
  voucherId: string;
  snapshot: VoucherSnapshot;
  discount: number;
}

/**
 * Giữ một lượt voucher cho đơn đang tạo (trong transaction đặt đơn): khoá
 * voucher, tự lưu cho nông dân nếu chưa lưu, kiểm tra điều kiện rồi tăng
 * used_count. Gọi `linkVoucherClaim` sau khi có id đơn.
 */
export async function reserveVoucher(
  q: Q,
  input: { voucherId: string; dealerId: string; userId: string; subtotal: number; now: Date },
): Promise<ReservedVoucher> {
  const [row] = await q(
    `SELECT ${VOUCHER_COLUMNS} FROM agrilink_vouchers WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
    [input.voucherId, input.dealerId],
  );
  if (!row) throw new BadRequestException('Voucher không còn khả dụng.');
  await q(
    `INSERT INTO agrilink_voucher_claims(voucher_id,user_id,organization_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [input.voucherId, input.userId, input.dealerId],
  );
  const [claim] = await q(
    `SELECT order_id FROM agrilink_voucher_claims WHERE voucher_id=$1 AND user_id=$2 FOR UPDATE`,
    [input.voucherId, input.userId],
  );
  const v = voucherFields(row);
  const reason = voucherUnusableReason(v, {
    now: input.now,
    subtotal: input.subtotal,
    usedByMe: claim?.order_id != null,
  });
  if (reason) throw new BadRequestException(reason);
  await q(`UPDATE agrilink_vouchers SET used_count=used_count+1,updated_at=now() WHERE id=$1`, [input.voucherId]);
  const snapshot: VoucherSnapshot = { title: v.title, type: v.type, value: v.value, maxDiscount: v.maxDiscount };
  return { voucherId: input.voucherId, snapshot, discount: voucherDiscount(snapshot, input.subtotal) };
}

export async function linkVoucherClaim(q: Q, voucherId: string, userId: string, orderId: string) {
  await q(
    `UPDATE agrilink_voucher_claims SET order_id=$3,used_at=now() WHERE voucher_id=$1 AND user_id=$2`,
    [voucherId, userId, orderId],
  );
}

/** Hoàn lượt khi đơn dùng voucher bị huỷ/từ chối. Gọi lại nhiều lần vẫn an toàn. */
export async function releaseVoucher(q: Q, order: { id: string; voucherId: string | null }) {
  if (!order.voucherId) return;
  // Khoá voucher trước (cùng thứ tự voucher → claim với lúc đặt đơn) để tránh deadlock.
  await q(`SELECT 1 FROM agrilink_vouchers WHERE id=$1 FOR UPDATE`, [order.voucherId]);
  const released = await q(
    `UPDATE agrilink_voucher_claims SET order_id=NULL,used_at=NULL WHERE voucher_id=$1 AND order_id=$2 RETURNING voucher_id`,
    [order.voucherId, order.id],
  );
  if (released.length)
    await q(
      `UPDATE agrilink_vouchers SET used_count=GREATEST(used_count-1,0),updated_at=now() WHERE id=$1`,
      [order.voucherId],
    );
}
