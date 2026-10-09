import { describeNotification, NotificationRow } from './notification-describe';

const ME = 'user-me';
const row = (over: Partial<NotificationRow>): NotificationRow => ({
  kind: 'comment',
  eventKey: null,
  postId: null,
  orderId: null,
  orderCode: null,
  orderRequesterId: null,
  offerIntentId: null,
  verificationStatus: null,
  ...over,
});

describe('describeNotification', () => {
  it('links community comments to the post', () => {
    expect(describeNotification(row({ kind: 'comment', postId: 'p1' }), ME)).toEqual({
      text: 'đã phản hồi cuộc trò chuyện bạn theo dõi',
      link: '/community/posts/p1',
    });
  });

  it('never builds a post link from a null-like id', () => {
    expect(describeNotification(row({ kind: 'moderation', postId: 'null' }), ME).link).toBeNull();
  });

  it('sends a new order to the dealer order page', () => {
    const r = row({
      kind: 'agrilink_order',
      eventKey: 'agrilink:o1:pending',
      orderId: 'o1',
      orderCode: 'AL-1',
      orderRequesterId: 'farmer',
    });
    expect(describeNotification(r, ME)).toEqual({
      text: 'Đơn mới AL-1 đang chờ bạn xác nhận',
      link: '/agrilink/quan-ly/don/o1',
    });
  });

  it('sends order updates to the buyer order page when the recipient placed the order', () => {
    const r = row({
      kind: 'agrilink_order',
      eventKey: 'agrilink:o1:confirmed',
      orderId: 'o1',
      orderCode: 'AL-1',
      orderRequesterId: ME,
    });
    expect(describeNotification(r, ME)).toEqual({
      text: 'Đại lý đã xác nhận đơn AL-1',
      link: '/agrilink/don-cua-toi/o1',
    });
  });

  it('describes a buyer cancellation for the dealer', () => {
    const r = row({
      kind: 'agrilink_order',
      eventKey: 'agrilink:o1:cancelled',
      orderId: 'o1',
      orderCode: 'AL-1',
      orderRequesterId: 'farmer',
    });
    expect(describeNotification(r, ME).text).toBe('Người mua đã huỷ đơn AL-1');
  });

  it('asks the buyer to rate a completed order', () => {
    const r = row({ kind: 'agrilink_rate', eventKey: 'agrilink-rate:o1', orderId: 'o1', orderCode: 'AL-1', orderRequesterId: ME });
    expect(describeNotification(r, ME)).toEqual({
      text: 'Hãy đánh giá đại lý cho đơn AL-1',
      link: '/agrilink/don-cua-toi/o1',
    });
  });

  it('links a dealer offer to the farmer intent', () => {
    const r = row({ kind: 'agrilink_offer', eventKey: 'agrilink-offer:f1', offerIntentId: 'i1' });
    expect(describeNotification(r, ME)).toEqual({
      text: 'Có đại lý gửi đề nghị cho nhu cầu của bạn',
      link: '/agrilink/nhu-cau/i1',
    });
  });

  it.each([
    ['accepted', 'Nông dân đã chấp nhận đề nghị của bạn — đơn mới đã được tạo'],
    ['declined', 'Nông dân đã từ chối đề nghị của bạn'],
    ['expired', 'Đề nghị của bạn đã hết hiệu lực'],
  ])('describes offer status %s for the dealer', (status, text) => {
    const r = row({ kind: 'agrilink_offer_status', eventKey: `agrilink-offer:f1:${status}` });
    expect(describeNotification(r, ME)).toEqual({ text, link: '/agrilink/quan-ly/nguon-hang' });
  });

  it('links leads and price reminders to the dealer pages', () => {
    expect(describeNotification(row({ kind: 'agrilink_lead', eventKey: 'agrilink-lead:i1:d1' }), ME).link).toBe(
      '/agrilink/quan-ly/nguon-hang',
    );
    expect(describeNotification(row({ kind: 'agrilink_price_reminder', eventKey: 'agrilink-price:f1:2026-09-29' }), ME)).toEqual({
      text: 'Giá thu mua sắp bị ẩn — hãy cập nhật hoặc giữ giá hôm nay',
      link: '/agrilink/quan-ly/thu-mua',
    });
  });

  it.each([
    ['verified', 'Đại lý của bạn đã được xác minh'],
    ['rejected', 'Hồ sơ xác minh chưa được duyệt — xem lý do'],
    ['pending', 'Hồ sơ xác minh đang chờ duyệt'],
  ])('describes verification status %s', (status, text) => {
    const r = row({ kind: 'agrilink_verification', verificationStatus: status });
    expect(describeNotification(r, ME)).toEqual({ text, link: '/agrilink/quan-ly/xac-minh' });
  });

  it.each([
    ['agrilink-complaint:t1:open:dealer', 'Có khiếu nại mới cần xử lý', '/agrilink/quan-ly/khieu-nai/t1'],
    ['agrilink-complaint:t1:escalated:dealer', 'Khiếu nại đã chuyển AgriLink xem xét', '/agrilink/quan-ly/khieu-nai/t1'],
    ['agrilink-complaint:t1:dealer_replied:buyer', 'Đại lý đã đề xuất cách giải quyết khiếu nại', '/agrilink/khieu-nai/t1'],
    ['agrilink-complaint:t1:resolved:buyer', 'Khiếu nại của bạn đã được giải quyết', '/agrilink/khieu-nai/t1'],
  ])('describes complaint event %s', (eventKey, text, link) => {
    expect(describeNotification(row({ kind: 'agrilink_complaint', eventKey }), ME)).toEqual({ text, link });
  });

  it('links support answers to the request', () => {
    expect(describeNotification(row({ kind: 'agrilink_support', eventKey: 'agrilink-support:t9:m1' }), ME)).toEqual({
      text: 'AgriLink đã trả lời yêu cầu hỗ trợ của bạn',
      link: '/agrilink/ho-tro/t9',
    });
  });

  it('falls back to a generic text without a link for unknown kinds', () => {
    expect(describeNotification(row({ kind: 'something_new' }), ME)).toEqual({ text: 'có cập nhật mới', link: null });
  });

  it('falls back to the order list when the order no longer exists', () => {
    const r = row({ kind: 'agrilink_order', eventKey: 'agrilink:o1:pending' });
    expect(describeNotification(r, ME)).toEqual({ text: 'Đơn hàng AgriLink có cập nhật mới', link: null });
  });
});
