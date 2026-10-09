import type { ChatMessage, ThreadSide, ThreadSummary } from '../../../services/agrilink-messaging.types';

/** Gộp tin mới vào danh sách hiện có (theo id), giữ thứ tự thời gian. */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  incoming.forEach((m) => byId.set(m.id, m));
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Mốc để hỏi tin mới hơn (tin mới nhất). */
export function latestCursor(messages: ChatMessage[]): string | undefined {
  return messages.length ? messages[messages.length - 1].createdAt : undefined;
}

export function previewText(thread: ThreadSummary, viewer: ThreadSide): string {
  const last = thread.lastMessage;
  if (!last) return 'Chưa có tin nhắn';
  if (last.orderId && !last.body) return 'Đơn hàng mới';
  const text = last.body || (last.hasImages ? 'Ảnh' : '');
  return last.side === viewer ? `Bạn: ${text}` : text;
}

const VN_OFFSET_MS = 7 * 3600 * 1000;
const vnDate = (iso: string | Date) => new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString();
const dayDiff = (iso: string, now: Date) =>
  Math.round((Date.parse(vnDate(now).slice(0, 10)) - Date.parse(vnDate(iso).slice(0, 10))) / 86400000);

/** Giờ trong danh sách hội thoại: hôm nay → HH:mm, hôm qua → "Hôm qua", còn lại dd/mm. */
export function inboxTime(iso: string, now = new Date()): string {
  const d = vnDate(iso);
  const diff = dayDiff(iso, now);
  if (diff <= 0) return d.slice(11, 16);
  if (diff === 1) return 'Hôm qua';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Nhãn ngăn cách ngày trong khung chat. */
export function dayLabel(iso: string, now = new Date()): string {
  const diff = dayDiff(iso, now);
  if (diff <= 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  const d = vnDate(iso);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Giờ gửi của một tin (HH:mm giờ VN). */
export function messageTime(iso: string): string {
  return vnDate(iso).slice(11, 16);
}

export const COMPLAINT_CATEGORY: Record<string, string> = {
  wrong_weight: 'Cân sai',
  late_payment: 'Chậm/thiếu tiền',
  no_show: 'Lỡ hẹn',
  wrong_item: 'Sai hàng',
  damaged: 'Hàng hỏng',
  late_delivery: 'Giao trễ',
  other: 'Khác',
};
export const COMPLAINT_CATEGORIES_BY_KIND = {
  sell: ['wrong_weight', 'late_payment', 'no_show', 'other'],
  buy: ['wrong_item', 'damaged', 'late_delivery', 'other'],
} as const;
export const COMPLAINT_WISH: Record<string, string> = {
  exchange: 'Đổi hàng',
  refund: 'Hoàn tiền một phần',
  notice: 'Chỉ báo để đại lý biết',
};
export const DEALER_PROPOSAL: Record<string, string> = {
  refund: 'Bù tiền / hoàn một phần',
  exchange: 'Đổi hàng',
  explain: 'Giải thích, không thay đổi',
  other: 'Khác',
};
export const RESOLUTION: Record<string, string> = {
  agreed: 'Hai bên đã thống nhất',
  buyer_favored: 'Nông dân đúng',
  dealer_favored: 'Đại lý đúng',
  settled: 'Hai bên đã thoả thuận',
};
export const COMPLAINT_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'Chờ đại lý phản hồi', tone: 'bg-warning text-dark' },
  dealer_replied: { label: 'Đại lý đã phản hồi', tone: 'bg-info text-dark' },
  escalated: { label: 'AgriLink đang xem xét', tone: 'bg-danger' },
  resolved: { label: 'Đã giải quyết', tone: 'bg-success' },
};
export const SUPPORT_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: 'Đang chờ', tone: 'bg-warning text-dark' },
  answered: { label: 'Đã trả lời', tone: 'bg-success' },
  closed: { label: 'Đã đóng', tone: 'bg-light text-dark border' },
};
export const SUPPORT_CATEGORY: Record<string, string> = {
  account: 'Tài khoản',
  orders: 'Đơn hàng',
  payment: 'Thanh toán',
  dealer: 'Đại lý',
  other: 'Khác',
};
