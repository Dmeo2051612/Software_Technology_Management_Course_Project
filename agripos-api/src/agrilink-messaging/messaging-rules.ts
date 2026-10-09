import { BadRequestException, ConflictException } from '@nestjs/common';

export type ThreadKind = 'chat' | 'complaint' | 'support';
export type Side = 'buyer' | 'dealer' | 'admin';
export type Actor = Side | 'system';
export type ComplaintAction = 'propose' | 'accept' | 'escalate' | 'resolve';

export interface ThreadAccess {
  kind: string;
  buyerId: string;
  organizationId: string | null;
  status: string;
  escalatedAt: Date | string | null;
  blockedByBuyer: boolean;
}
export interface MessagingViewer {
  id: string;
  role: string;
  platformRole: string | null;
  memberships: { id: string }[];
}

/** Nhân viên đại lý được đọc và trả lời thay đại lý (kho, kế toán… thì không). */
export const DEALER_ROLES = ['owner', 'manager', 'cashier'];

export const COMPLAINT_AUTO_ESCALATE_HOURS = 72;
export const COMPLAINT_WINDOW_DAYS = 14;
export const MAX_MESSAGE_IMAGES = 4;

/** Vai trò của người xem trong một cuộc trò chuyện; null = không được xem. */
export function threadSide(v: MessagingViewer, t: ThreadAccess): Side | null {
  if (t.buyerId === v.id) return 'buyer';
  if (t.organizationId && DEALER_ROLES.includes(v.role) && v.memberships.some((m) => m.id === t.organizationId)) return 'dealer';
  if (v.platformRole && (t.kind === 'support' || (t.kind === 'complaint' && t.escalatedAt))) return 'admin';
  return null;
}

export function assertCanPost(t: ThreadAccess, side: Side): void {
  if (t.kind === 'chat' && t.blockedByBuyer && side === 'dealer')
    throw new ConflictException('Khách đã chặn tin nhắn từ đại lý.');
  if (t.kind === 'complaint' && t.status === 'resolved') throw new ConflictException('Khiếu nại đã đóng.');
  if (t.kind === 'support' && t.status === 'closed') throw new ConflictException('Yêu cầu hỗ trợ đã đóng.');
}

const CATEGORIES = {
  sell: ['wrong_weight', 'late_payment', 'no_show', 'other'],
  buy: ['wrong_item', 'damaged', 'late_delivery', 'other'],
} as const;

export function complaintCategories(kind: 'buy' | 'sell'): readonly string[] {
  return CATEGORIES[kind];
}

/** Lý do không được khiếu nại, hoặc null nếu được. */
export function complaintEligibility(
  order: { status: string; updatedAt: Date | string },
  now = new Date(),
): string | null {
  if (!['confirmed', 'delivering', 'completed', 'cancelled'].includes(order.status))
    return 'Chỉ khiếu nại được đơn đã được đại lý xử lý.';
  const age = now.getTime() - new Date(order.updatedAt).getTime();
  if (age > COMPLAINT_WINDOW_DAYS * 86400000) return `Đã quá ${COMPLAINT_WINDOW_DAYS} ngày kể từ lần cập nhật cuối của đơn.`;
  return null;
}

const ACTOR_OF: Record<ComplaintAction, Actor[]> = {
  propose: ['dealer'],
  accept: ['buyer'],
  escalate: ['buyer', 'system'],
  resolve: ['admin'],
};

export function nextComplaintStatus(status: string, action: ComplaintAction, actor: Actor): string {
  if (!ACTOR_OF[action].includes(actor)) throw new BadRequestException('Bạn không thể thực hiện thao tác này.');
  const outOfTurn = () => new ConflictException('Khiếu nại không ở trạng thái phù hợp.');
  switch (action) {
    case 'propose':
      if (status !== 'open' && status !== 'dealer_replied') throw outOfTurn();
      return 'dealer_replied';
    case 'accept':
      if (status !== 'dealer_replied') throw outOfTurn();
      return 'resolved';
    case 'escalate':
      if (actor === 'buyer' && status === 'open')
        throw new ConflictException('Hãy chờ đại lý phản hồi hoặc tự động chuyển sau 3 ngày.');
      if (status !== 'open' && status !== 'dealer_replied') throw outOfTurn();
      return 'escalated';
    case 'resolve':
      if (status !== 'escalated') throw outOfTurn();
      return 'resolved';
  }
}

const ORDER_LINES: Record<string, (code: string) => string> = {
  confirmed: (c) => `Đại lý đã xác nhận đơn ${c}`,
  rejected: (c) => `Đại lý đã từ chối đơn ${c}`,
  delivering: (c) => `Đơn ${c} đang được giao`,
  completed: (c) => `Đơn ${c} đã hoàn thành`,
  cancelled: (c) => `Đơn ${c} đã bị huỷ`,
};

/** Dòng hệ thống trong khung chat khi đơn đổi trạng thái (null = không ghi). */
export function orderLineText(status: string, code: string): string | null {
  return ORDER_LINES[status]?.(code) ?? null;
}
