import type { DailyPriceCommodity } from '../../services/agrilink-matching.types';

const number = new Intl.NumberFormat('vi-VN');
export const formatPrice = (value: number) => number.format(value);

/** Mức tăng/giảm so với phiên trước: "▲ 500" xanh, "▼ 700" đỏ, "— 0" xám. */
export function priceChange(change: number | null): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (change == null) return null;
  if (change > 0) return { text: `▲ ${number.format(change)}`, tone: 'up' };
  if (change < 0) return { text: `▼ ${number.format(-change)}`, tone: 'down' };
  return { text: '— 0', tone: 'flat' };
}

const vnDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
const vnTime = (d: Date) =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
// vi-VN dùng "28-09" ở một số trình duyệt; ghép tay để luôn là "28/09".
const vnDayMonth = (d: Date) => vnDay(d).slice(5).split('-').reverse().join('/');

/** "Cập nhật 14:30 hôm nay" hoặc "Cập nhật 07:00 28/09" (giờ Việt Nam). */
export function pricesUpdatedLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Chưa có dữ liệu';
  const at = new Date(iso);
  const day = vnDay(at) === vnDay(now) ? 'hôm nay' : vnDayMonth(at);
  return `Cập nhật ${vnTime(at)} ${day}`;
}

/** Mở sẵn loại nông sản đầu tiên có giá. */
export function firstWithData(list: Pick<DailyPriceCommodity, 'key' | 'regions'>[]): DailyPriceCommodity['key'] {
  return (list.find((c) => c.regions.length > 0) ?? list[0])?.key ?? 'coffee';
}

/** "2026-09-29" → "29/09". */
const dayMonth = (isoDay: string) => isoDay.slice(5, 10).split('-').reverse().join('/');

/** Ngày của giá mới nhất trong danh sách (hiện cạnh tiêu đề), ví dụ "29/09". */
export function pricesDate(regions: DailyPriceCommodity['regions']): string {
  const days = regions.map((r) => r.recordedAt).sort();
  const newest = days[days.length - 1];
  return newest ? dayMonth(newest) : '';
}

/** Tỉnh nào có giá cũ hơn ngày ở tiêu đề thì ghi ngày riêng (ví dụ ngày lễ chưa có giá mới). */
export function regionDateNote(recordedAt: string, headerDate: string): string {
  const day = dayMonth(recordedAt);
  return day === headerDate ? '' : day;
}
