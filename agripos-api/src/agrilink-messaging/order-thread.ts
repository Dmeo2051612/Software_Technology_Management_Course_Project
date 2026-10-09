import { Logger } from '@nestjs/common';
import { orderLineText } from './messaging-rules';

export type Query = (sql: string, params: unknown[]) => Promise<any[]>;
const log = new Logger('AgrilinkOrderThread');

/** Khung chat duy nhất của cặp nông dân – đại lý (tạo nếu chưa có). */
export async function ensureChatThread(q: Query, buyerId: string, organizationId: string): Promise<string> {
  const [row] = await q(
    `INSERT INTO agrilink_threads(kind,buyer_id,organization_id) VALUES('chat',$1,$2)
     ON CONFLICT (buyer_id,organization_id) WHERE kind='chat' DO UPDATE SET last_message_at=agrilink_threads.last_message_at
     RETURNING id`,
    [buyerId, organizationId],
  );
  return row.id;
}

/**
 * Ghi vào khung chat trong cùng giao dịch của đơn, nhưng cô lập bằng SAVEPOINT:
 * nếu phần chat lỗi (vd. chưa chạy setup) thì đơn hàng vẫn tiếp tục bình thường.
 */
async function isolated(q: Query, work: () => Promise<void>): Promise<void> {
  await q('SAVEPOINT agrilink_chat', []);
  try {
    await work();
    await q('RELEASE SAVEPOINT agrilink_chat', []);
  } catch (error) {
    await q('ROLLBACK TO SAVEPOINT agrilink_chat', []);
    log.warn(`Không ghi được vào khung chat: ${(error as Error).message}`);
  }
}

async function append(q: Query, threadId: string, body: string, orderId: string | null): Promise<void> {
  await q(
    `INSERT INTO agrilink_messages(thread_id,sender_side,body,order_id) VALUES($1,'system',$2,$3)`,
    [threadId, body, orderId],
  );
  await q('UPDATE agrilink_threads SET last_message_at=now() WHERE id=$1', [threadId]);
}

/** Thẻ đơn hàng trong khung chat khi nông dân đặt đơn. */
export async function postOrderCard(q: Query, order: { id: string; requesterId: string; organizationId: string }): Promise<void> {
  await isolated(q, async () => {
    const threadId = await ensureChatThread(q, order.requesterId, order.organizationId);
    await append(q, threadId, '', order.id);
  });
}

/** Dòng hệ thống khi đơn đổi trạng thái (xác nhận, giao, hoàn thành, huỷ…). */
export async function postOrderStatusLine(
  q: Query,
  order: { id: string; code: string; requesterId: string; organizationId: string },
  status: string,
): Promise<void> {
  const text = orderLineText(status, order.code);
  if (!text) return;
  await isolated(q, async () => {
    const threadId = await ensureChatThread(q, order.requesterId, order.organizationId);
    await append(q, threadId, text, null);
  });
}
