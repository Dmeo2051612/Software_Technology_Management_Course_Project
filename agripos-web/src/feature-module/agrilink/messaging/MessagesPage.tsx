import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, MoneyText, PillGroup } from '../../../components/ui';
import { apiError } from '../../../services/agrilink.service';
import { messagingApi, type InboxSide } from '../../../services/agrilink-messaging.service';
import type { ThreadDetail, ThreadSummary } from '../../../services/agrilink-messaging.types';
import type { OrderStatus } from '../../../services/agrilink.types';
import { initials } from '../../../utils/initials';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import OrderStatusBadge from '../components/OrderStatusBadge';
import Conversation from './Conversation';
import { inboxTime, previewText } from './messaging';
import { usePolling } from './usePolling';
import './messaging.css';
import VerifiedBadge from '../../../components/brand/VerifiedBadge';

const QUICK_REPLIES: Record<InboxSide, string[]> = {
  buyer: ['Còn hàng không ạ?', 'Giao tận nơi được không?', 'Giá sỉ bao nhiêu ạ?'],
  dealer: ['Dạ còn hàng ạ', 'Bên em giao trong ngày', 'Anh/chị gửi giúp em địa chỉ nhé'],
};

function Avatar({ thread, side }: { thread: ThreadSummary; side: InboxSide }) {
  if (side === 'buyer') {
    return thread.dealerLogoUrl ? (
      <img className="inbox-avatar shop" src={normalizeImageUrl(thread.dealerLogoUrl) || ''} alt="" />
    ) : (
      <span className="inbox-avatar shop">{initials(thread.dealerName || 'Đại lý')}</span>
    );
  }
  return <span className="inbox-avatar">{initials(thread.buyerName)}</span>;
}

export default function MessagesPage({ side }: { side: InboxSide }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const base = side === 'dealer' ? '/agrilink/quan-ly/tin-nhan' : '/agrilink/tin-nhan';
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const loadInbox = useCallback(async () => {
    const rows = await messagingApi.threads({ as: side, kind: 'chat' });
    setThreads(rows);
    return rows;
  }, [side]);

  useEffect(() => {
    loadInbox()
      .then((rows) => {
        if (!id && rows.length) navigate(`${base}/${rows[0].id}`, { replace: true });
      })
      .catch((e) => setError(apiError(e)));
    // Chỉ tải danh sách khi vào trang; chọn hội thoại đầu tiên nếu chưa chọn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadInbox]);
  usePolling(() => loadInbox().then(() => undefined), 30000);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let active = true;
    messagingApi
      .thread(id)
      .then((t) => active && setDetail(t))
      .catch((e) => active && setError(apiError(e)));
    return () => {
      active = false;
    };
  }, [id]);

  // Có tin mới hoặc vừa gửi/đọc: tải lại danh sách để cập nhật dòng xem trước và trạng thái chưa đọc.
  const markSeen = useCallback(() => {
    setThreads((rows) => rows?.map((t) => (t.id === id ? { ...t, unread: false } : t)) ?? rows);
    void loadInbox().catch(() => {});
  }, [id, loadInbox]);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('vi');
    return (threads ?? []).filter((t) => {
      if (filter === 'unread' && !t.unread) return false;
      const name = side === 'buyer' ? t.dealerName : t.buyerName;
      return !q || (name ?? '').toLocaleLowerCase('vi').includes(q);
    });
  }, [threads, filter, search, side]);
  const unreadCount = threads?.filter((t) => t.unread).length ?? 0;

  const block = async (blocked: boolean) => {
    if (!detail) return;
    try {
      await messagingApi.block(detail.id, blocked);
      setDetail({ ...detail, blockedByBuyer: blocked });
    } catch (e) {
      setError(apiError(e));
    }
  };

  const header = detail && (
    <div className="conv-head">
      {side === 'buyer' ? (
        <>
          <Avatar thread={detail} side="buyer" />
          <div className="conv-head-main">
            <strong>{detail.dealerName}</strong>
            {detail.dealerVerified && <VerifiedBadge />}
            {detail.dealerRegion && <small>{detail.dealerRegion}</small>}
          </div>
          <Link className="btn btn-sm btn-outline-primary" to={`/agrilink/dai-ly/${detail.organizationId}`}>
            Xem gian hàng
          </Link>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void block(!detail.blockedByBuyer)}>
            {detail.blockedByBuyer ? 'Bỏ chặn' : 'Chặn đại lý'}
          </button>
        </>
      ) : (
        <>
          <Avatar thread={detail} side="dealer" />
          <div className="conv-head-main">
            <strong>{detail.buyerName}</strong>
            <small>{detail.orders?.length ? `${detail.orders.length} đơn với đại lý` : 'Chưa có đơn'}</small>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="messages-page">
      <div className={`messages-layout${side === 'dealer' && detail ? ' with-info' : ''}`}>
        <aside className="inbox" aria-label="Danh sách hội thoại">
          <div className="inbox-head">
            <h1>{side === 'dealer' ? 'Tin nhắn khách hàng' : 'Tin nhắn'}</h1>
            <input
              className="form-control"
              placeholder={side === 'dealer' ? 'Tìm khách hàng…' : 'Tìm đại lý…'}
              aria-label="Tìm hội thoại"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <PillGroup className="inbox-filter" role="group" aria-label="Lọc hội thoại" activeKey={filter}>
              <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                Tất cả
              </button>
              <button type="button" className={filter === 'unread' ? 'active' : ''} aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
                Chưa đọc{unreadCount ? ` (${unreadCount})` : ''}
              </button>
            </PillGroup>
          </div>
          <div className="inbox-list">
            {threads === null ? (
              <p className="conv-empty">Đang tải…</p>
            ) : visible.length === 0 ? (
              <p className="conv-empty">
                {side === 'buyer' ? 'Chưa có cuộc trò chuyện. Bấm “Nhắn đại lý” ở gian hàng để bắt đầu.' : 'Chưa có tin nhắn từ khách.'}
              </p>
            ) : (
              visible.map((t) => (
                <Link key={t.id} to={`${base}/${t.id}`} className={`inbox-item${t.id === id ? ' active' : ''}${t.unread ? ' unread' : ''}`}>
                  <Avatar thread={t} side={side} />
                  <span className="inbox-item-main">
                    <span className="inbox-item-row">
                      <strong>{side === 'buyer' ? t.dealerName : t.buyerName}</strong>
                      <small>{inboxTime(t.lastMessageAt)}</small>
                    </span>
                    <span className="inbox-preview">{previewText(t, side)}</span>
                  </span>
                  {t.unread && <span className="inbox-dot" aria-label="Chưa đọc" />}
                </Link>
              ))
            )}
          </div>
        </aside>

        {detail ? (
          <Conversation
            key={detail.id}
            thread={detail}
            viewer={side}
            header={header}
            quickReplies={QUICK_REPLIES[side]}
            placeholder={side === 'dealer' ? `Trả lời với tư cách ${detail.dealerName ?? 'đại lý'}…` : 'Nhập tin nhắn…'}
            disabledReason={
              detail.blockedByBuyer
                ? side === 'buyer'
                  ? 'Bạn đã chặn đại lý này. Bỏ chặn để tiếp tục trò chuyện.'
                  : 'Khách đã chặn tin nhắn từ đại lý.'
                : null
            }
            onActivity={markSeen}
          />
        ) : (
          <div className="conv conv-placeholder">
            {error ? <p className="text-danger">{error}</p> : <EmptyState title="Chọn một cuộc trò chuyện" />}
          </div>
        )}

        {side === 'dealer' && detail && (
          <aside className="conv-info" aria-label="Thông tin khách">
            <strong>{detail.buyerName}</strong>
            <h2>Đơn với khách này</h2>
            {detail.orders?.length ? (
              detail.orders.map((o) => (
                <Link key={o.id} to={`/agrilink/quan-ly/don/${o.id}`} className="conv-info-order">
                  <span className="inbox-item-row">
                    <strong>{o.code}</strong>
                    <OrderStatusBadge status={o.status as OrderStatus} />
                  </span>
                  <small>
                    {o.kind === 'sell' ? 'Mua nông sản' : 'Bán vật tư'} · <MoneyText value={Math.round(o.total)} />
                  </small>
                </Link>
              ))
            ) : (
              <p className="text-muted small">Khách chưa đặt đơn nào.</p>
            )}
            <h2>Ghi chú</h2>
            <p className="text-muted small">Khách thấy tin nhắn dưới tên đại lý; tên nhân viên chỉ hiện trong kênh đại lý.</p>
          </aside>
        )}
      </div>
    </div>
  );
}
