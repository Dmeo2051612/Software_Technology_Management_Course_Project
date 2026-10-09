import { describe, expect, it } from 'vitest';
import type { ChatMessage, ThreadSummary } from '../../../services/agrilink-messaging.types';
import { dayLabel, inboxTime, latestCursor, mergeMessages, previewText } from './messaging';

const msg = (id: string, createdAt: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, createdAt, senderSide: 'buyer', senderId: 'u', senderName: 'A', body: id, images: [], ...over,
});

describe('mergeMessages', () => {
  it('appends new messages once and keeps them in time order', () => {
    const a = msg('a', '2026-09-29T01:00:00.000Z');
    const b = msg('b', '2026-09-29T02:00:00.000Z');
    const c = msg('c', '2026-09-29T03:00:00.000Z');
    expect(mergeMessages([a, b], [b, c]).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(mergeMessages([c], [a]).map((m) => m.id)).toEqual(['a', 'c']);
  });
  it('gives the polling cursor of the newest message', () => {
    expect(latestCursor([])).toBeUndefined();
    expect(latestCursor([msg('a', '2026-09-29T01:00:00.000Z'), msg('b', '2026-09-29T02:00:00.000Z')])).toBe('2026-09-29T02:00:00.000Z');
  });
});

describe('previewText', () => {
  const thread = (lastMessage: ThreadSummary['lastMessage']) => ({ lastMessage }) as ThreadSummary;
  it('prefixes my own messages and describes photos and order cards', () => {
    expect(previewText(thread({ body: 'Còn hàng không?', side: 'buyer', hasImages: false, orderId: null, createdAt: '' }), 'buyer')).toBe('Bạn: Còn hàng không?');
    expect(previewText(thread({ body: 'Dạ còn', side: 'dealer', hasImages: false, orderId: null, createdAt: '' }), 'buyer')).toBe('Dạ còn');
    expect(previewText(thread({ body: '', side: 'dealer', hasImages: true, orderId: null, createdAt: '' }), 'buyer')).toBe('Ảnh');
    expect(previewText(thread({ body: '', side: 'system', hasImages: false, orderId: 'o', createdAt: '' }), 'buyer')).toBe('Đơn hàng mới');
    expect(previewText(thread(null), 'buyer')).toBe('Chưa có tin nhắn');
  });
});

describe('times (Vietnam)', () => {
  const now = new Date('2026-09-29T08:00:00.000Z'); // 15:00 giờ VN
  it('shows time today, "Hôm qua" yesterday and a date otherwise', () => {
    expect(inboxTime('2026-09-29T02:42:00.000Z', now)).toBe('09:42');
    expect(inboxTime('2026-09-28T09:00:00.000Z', now)).toBe('Hôm qua');
    expect(inboxTime('2026-09-20T09:00:00.000Z', now)).toBe('20/09');
  });
  it('labels day separators', () => {
    expect(dayLabel('2026-09-29T02:00:00.000Z', now)).toBe('Hôm nay');
    expect(dayLabel('2026-09-28T02:00:00.000Z', now)).toBe('Hôm qua');
    expect(dayLabel('2026-09-10T02:00:00.000Z', now)).toBe('10/09/2026');
  });
});

describe('complaint stepper', () => {
  it('marks "Đã gửi" done while waiting for the dealer and finishes on resolution', async () => {
    const { stepIndex } = await import('./ComplaintPage');
    expect(stepIndex('open')).toBe(2);
    expect(stepIndex('dealer_replied')).toBe(3);
    expect(stepIndex('escalated')).toBe(3);
    expect(stepIndex('resolved')).toBe(5);
    // Import cả trang (kèm CSS, store) chậm khi vitest chạy song song nhiều file → nới thời gian.
  }, 20_000);
});
