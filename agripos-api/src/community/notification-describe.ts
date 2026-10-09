/** Dữ liệu thô của một thông báo kèm các trường tra cứu (đơn, đề nghị, xác minh). */
export interface NotificationRow {
  kind: string;
  eventKey: string | null;
  postId: string | null;
  orderId: string | null;
  orderCode: string | null;
  orderRequesterId: string | null;
  offerIntentId: string | null;
  verificationStatus: string | null;
}

export interface NotificationDescription {
  text: string;
  link: string | null;
}

const keyPart = (key: string | null, index: number) => key?.split(':')[index] ?? '';

const postLink = (postId: string | null) => {
  const id = postId?.trim();
  return id && id !== 'null' && id !== 'undefined' ? `/community/posts/${id}` : null;
};

const BUYER_ORDER_TEXT: Record<string, (code: string) => string> = {
  confirmed: (code) => `Đại lý đã xác nhận đơn ${code}`,
  rejected: (code) => `Đại lý đã từ chối đơn ${code}`,
  delivering: (code) => `Đơn ${code} đang được giao`,
  completed: (code) => `Đơn ${code} đã hoàn thành`,
  cancelled: (code) => `Đơn ${code} đã bị huỷ`,
};

const DEALER_ORDER_TEXT: Record<string, (code: string) => string> = {
  pending: (code) => `Đơn mới ${code} đang chờ bạn xác nhận`,
  cancelled: (code) => `Người mua đã huỷ đơn ${code}`,
};

const OFFER_STATUS_TEXT: Record<string, string> = {
  accepted: 'Nông dân đã chấp nhận đề nghị của bạn — đơn mới đã được tạo',
  declined: 'Nông dân đã từ chối đề nghị của bạn',
};

const VERIFICATION_TEXT: Record<string, string> = {
  verified: 'Đại lý của bạn đã được xác minh',
  rejected: 'Hồ sơ xác minh chưa được duyệt — xem lý do',
  pending: 'Hồ sơ xác minh đang chờ duyệt',
};

function describeOrder(row: NotificationRow, recipientId: string): NotificationDescription {
  if (!row.orderId || !row.orderCode) return { text: 'Đơn hàng AgriLink có cập nhật mới', link: null };
  const status = keyPart(row.eventKey, 2);
  const code = row.orderCode;
  if (row.orderRequesterId === recipientId) {
    const text = BUYER_ORDER_TEXT[status]?.(code) ?? `Đơn ${code} có cập nhật mới`;
    return { text, link: `/agrilink/don-cua-toi/${row.orderId}` };
  }
  const text = DEALER_ORDER_TEXT[status]?.(code) ?? `Đơn ${code} có cập nhật mới`;
  return { text, link: `/agrilink/quan-ly/don/${row.orderId}` };
}

const COMPLAINT_TEXT: Record<string, Record<string, string>> = {
  dealer: {
    open: 'Có khiếu nại mới cần xử lý',
    escalated: 'Khiếu nại đã chuyển AgriLink xem xét',
    resolved: 'Khiếu nại đã được giải quyết',
  },
  buyer: {
    dealer_replied: 'Đại lý đã đề xuất cách giải quyết khiếu nại',
    escalated: 'Khiếu nại của bạn đã chuyển AgriLink xem xét',
    resolved: 'Khiếu nại của bạn đã được giải quyết',
  },
};

/** event_key: agrilink-complaint:<threadId>:<status>:<buyer|dealer> */
function describeComplaint(eventKey: string | null): NotificationDescription {
  const id = keyPart(eventKey, 1);
  const status = keyPart(eventKey, 2);
  const audience = keyPart(eventKey, 3) === 'dealer' ? 'dealer' : 'buyer';
  return {
    text: COMPLAINT_TEXT[audience][status] ?? 'Khiếu nại có cập nhật mới',
    link: id ? (audience === 'dealer' ? `/agrilink/quan-ly/khieu-nai/${id}` : `/agrilink/khieu-nai/${id}`) : null,
  };
}

/** Câu mô tả và đường dẫn đích cho một thông báo, tuỳ theo người nhận. */
export function describeNotification(row: NotificationRow, recipientId: string): NotificationDescription {
  switch (row.kind) {
    case 'comment':
      return { text: 'đã phản hồi cuộc trò chuyện bạn theo dõi', link: postLink(row.postId) };
    case 'moderation':
      return { text: 'đã xử lý một báo cáo liên quan đến bạn', link: postLink(row.postId) };
    case 'agrilink_order':
      return describeOrder(row, recipientId);
    case 'agrilink_rate':
      return row.orderId && row.orderCode
        ? { text: `Hãy đánh giá đại lý cho đơn ${row.orderCode}`, link: `/agrilink/don-cua-toi/${row.orderId}` }
        : { text: 'Hãy đánh giá đơn hàng đã hoàn thành', link: '/agrilink/don-cua-toi' };
    case 'agrilink_offer':
      return {
        text: 'Có đại lý gửi đề nghị cho nhu cầu của bạn',
        link: row.offerIntentId ? `/agrilink/nhu-cau/${row.offerIntentId}` : '/agrilink/nhu-cau',
      };
    case 'agrilink_offer_status':
      return {
        text: OFFER_STATUS_TEXT[keyPart(row.eventKey, 2)] ?? 'Đề nghị của bạn đã hết hiệu lực',
        link: '/agrilink/quan-ly/nguon-hang',
      };
    case 'agrilink_lead':
      return { text: 'Có nhu cầu mới phù hợp với tin thu mua của bạn', link: '/agrilink/quan-ly/nguon-hang' };
    case 'agrilink_price_reminder':
      return { text: 'Giá thu mua sắp bị ẩn — hãy cập nhật hoặc giữ giá hôm nay', link: '/agrilink/quan-ly/thu-mua' };
    case 'agrilink_verification':
      return {
        text: VERIFICATION_TEXT[row.verificationStatus ?? ''] ?? 'Hồ sơ xác minh có cập nhật mới',
        link: '/agrilink/quan-ly/xac-minh',
      };
    case 'agrilink_complaint':
      return describeComplaint(row.eventKey);
    case 'agrilink_support':
      return { text: 'AgriLink đã trả lời yêu cầu hỗ trợ của bạn', link: `/agrilink/ho-tro/${keyPart(row.eventKey, 1)}` };
    default:
      return { text: 'có cập nhật mới', link: null };
  }
}
