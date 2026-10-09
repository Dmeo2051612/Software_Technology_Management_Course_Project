import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MoneyText } from '../../../components/ui';
import { apiError } from '../../../services/agrilink.service';
import { messagingApi } from '../../../services/agrilink-messaging.service';
import type { ChatMessage, MessageOrderCard, ThreadDetail, ThreadSide } from '../../../services/agrilink-messaging.types';
import type { OrderStatus } from '../../../services/agrilink.types';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import OrderStatusBadge from '../components/OrderStatusBadge';
import { dayLabel, latestCursor, mergeMessages, messageTime } from './messaging';
import { usePolling } from './usePolling';

const MAX_IMAGES = 4;

function orderLink(order: { id: string }, viewer: ThreadSide) {
  return viewer === 'dealer' ? `/agrilink/quan-ly/don/${order.id}` : `/agrilink/don-cua-toi/${order.id}`;
}

function OrderCard({ order, viewer }: { order: MessageOrderCard; viewer: ThreadSide }) {
  const items = order.items ?? [];
  return (
    <div className="msg-order">
      <div className="msg-order-row">
        <strong>
          <i className="ti ti-package" aria-hidden="true" /> Đơn {order.code}
        </strong>
        <OrderStatusBadge status={order.status as OrderStatus} />
      </div>
      <p>
        {items.map((i) => `${i.quantity} × ${i.name}${i.unit ? ` (${i.unit})` : ''}`).join(', ') || 'Đơn hàng AgriLink'}
      </p>
      <div className="msg-order-row">
        <MoneyText value={Math.round(order.total)} bold />
        <Link className="btn btn-sm btn-outline-primary" to={orderLink(order, viewer)}>
          Xem đơn
        </Link>
      </div>
    </div>
  );
}

function Bubble({ message, viewer }: { message: ChatMessage; viewer: ThreadSide }) {
  const mine = message.senderSide === viewer;
  const signature =
    viewer === 'dealer' && message.senderSide === 'dealer' && message.staffName
      ? ` · ${message.staffName}`
      : message.senderSide === 'admin' && viewer !== 'admin'
        ? ' · AgriLink'
        : '';
  return (
    <div className={`msg ${mine ? 'out' : 'in'}${message.senderSide === 'admin' ? ' admin' : ''}`}>
      {message.images?.map((url) => (
        <a key={url} href={normalizeImageUrl(url) || '#'} target="_blank" rel="noreferrer" className="msg-photo">
          <img src={normalizeImageUrl(url) || ''} alt="Ảnh đính kèm" />
        </a>
      ))}
      {message.body && <span className="msg-text">{message.body}</span>}
      <small>
        {messageTime(message.createdAt)}
        {signature}
      </small>
    </div>
  );
}

/**
 * Khung hội thoại dùng chung cho chat, khiếu nại và hỗ trợ.
 * Tin mới được lấy mỗi 5 giây (không cần máy chủ realtime).
 */
export default function Conversation({
  thread,
  viewer,
  header,
  quickReplies = [],
  placeholder = 'Nhập tin nhắn…',
  disabledReason,
  onActivity,
  refreshKey = 0,
}: {
  thread: ThreadDetail;
  viewer: ThreadSide;
  header?: ReactNode;
  quickReplies?: string[];
  placeholder?: string;
  disabledReason?: string | null;
  onActivity?: () => void;
  refreshKey?: number;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef<string | undefined>(undefined);
  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownIds.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  const scrollToEnd = () =>
    window.requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    messagingApi
      .messages(thread.id)
      .then((rows) => {
        if (!active) return;
        setMessages(rows);
        setLoadFailed(false);
        cursorRef.current = latestCursor(rows);
        scrollToEnd();
        void messagingApi.read(thread.id).then(() => onActivity?.()).catch(() => {});
      })
      .catch((e) => {
        if (!active) return;
        setError(apiError(e));
        setLoadFailed(true);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // onActivity chỉ để báo lại danh sách; không cần tải lại khi nó đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, refreshKey]);

  const poll = useCallback(async () => {
    const rows = await messagingApi.messages(thread.id, cursorRef.current ? { after: cursorRef.current } : {});
    setLoadFailed(false);
    // Chỉ khi thật sự có tin mới mới cuộn xuống, đánh dấu đã đọc và báo danh sách.
    const fresh = rows.filter((m) => !knownIds.current.has(m.id));
    if (!fresh.length) return;
    setMessages((current) => {
      const merged = mergeMessages(current, fresh);
      cursorRef.current = latestCursor(merged);
      return merged;
    });
    scrollToEnd();
    await messagingApi.read(thread.id);
    onActivity?.();
  }, [thread.id, onActivity]);
  usePolling(poll, 5000, !loading);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files).slice(0, MAX_IMAGES - images.length)) {
        const { url } = await messagingApi.uploadImage(thread.id, file);
        setImages((current) => [...current, url].slice(0, MAX_IMAGES));
      }
    } catch (e) {
      setError(apiError(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const send = async (body = text) => {
    const content = body.trim();
    if ((!content && !images.length) || sending) return;
    setSending(true);
    setError('');
    try {
      const sent = await messagingApi.send(thread.id, { body: content, images });
      setMessages((current) => {
        const merged = mergeMessages(current, [{ ...sent, senderName: null, images: sent.images ?? images }]);
        cursorRef.current = latestCursor(merged);
        return merged;
      });
      setText('');
      setImages([]);
      scrollToEnd();
      onActivity?.();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setSending(false);
    }
  };

  const activeOrder = thread.orders?.find((o) => ['pending', 'confirmed', 'delivering'].includes(o.status));

  return (
    <section className="conv" aria-label="Cuộc trò chuyện">
      {header}
      {thread.kind === 'chat' && activeOrder && (
        <div className="conv-pinned">
          <i className="ti ti-package" aria-hidden="true" />
          <span className="conv-pinned-text">
            <strong>Đơn {activeOrder.code}</strong> · <MoneyText value={Math.round(activeOrder.total)} />
          </span>
          <OrderStatusBadge status={activeOrder.status as OrderStatus} />
          <Link className="btn btn-sm btn-outline-primary" to={orderLink(activeOrder, viewer)}>
            Xem đơn
          </Link>
        </div>
      )}
      <div className="conv-messages" ref={listRef} aria-live="polite">
        {loading ? (
          <p className="conv-empty">Đang tải tin nhắn…</p>
        ) : loadFailed && messages.length === 0 ? (
          <p className="conv-empty">Chưa tải được tin nhắn ({error}). Đang thử lại…</p>
        ) : messages.length === 0 ? (
          <p className="conv-empty">Hãy gửi lời chào để bắt đầu trò chuyện.</p>
        ) : (
          messages.map((m, index) => {
            const day = dayLabel(m.createdAt);
            const showDay = index === 0 || dayLabel(messages[index - 1].createdAt) !== day;
            return (
              <Fragment key={m.id}>
                {showDay && <span className="conv-day">{day}</span>}
                {m.order ? (
                  <OrderCard order={m.order} viewer={viewer} />
                ) : m.senderSide === 'system' ? (
                  <span className="conv-system">
                    {m.body} · {messageTime(m.createdAt)}
                  </span>
                ) : (
                  <Bubble message={m} viewer={viewer} />
                )}
              </Fragment>
            );
          })
        )}
      </div>
      {disabledReason ? (
        <p className="conv-disabled">{disabledReason}</p>
      ) : (
        <>
          {quickReplies.length > 0 && (
            <div className="conv-quick">
              {quickReplies.map((reply) => (
                <button key={reply} type="button" disabled={sending} onClick={() => void send(reply)}>
                  {reply}
                </button>
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className="conv-attachments">
              {images.map((url) => (
                <span key={url}>
                  <img src={normalizeImageUrl(url) || ''} alt="Ảnh sắp gửi" />
                  <button type="button" aria-label="Bỏ ảnh" onClick={() => setImages((c) => c.filter((x) => x !== url))}>
                    <i className="ti ti-x" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {error && (
            <p className="conv-error" role="alert">
              {error}
            </p>
          )}
          <div className="conv-composer">
            <button
              type="button"
              className="conv-icon"
              aria-label="Gửi ảnh"
              disabled={uploading || images.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              <i className="ti ti-photo" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="visually-hidden"
              tabIndex={-1}
              aria-label="Chọn ảnh gửi kèm"
              onChange={(e) => void upload(e.target.files)}
            />
            <textarea
              rows={1}
              value={text}
              maxLength={2000}
              placeholder={uploading ? 'Đang tải ảnh…' : placeholder}
              aria-label="Nội dung tin nhắn"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending || uploading || (!text.trim() && !images.length)}
              onClick={() => void send()}
            >
              <i className="ti ti-send me-1" />
              Gửi
            </button>
          </div>
        </>
      )}
    </section>
  );
}
