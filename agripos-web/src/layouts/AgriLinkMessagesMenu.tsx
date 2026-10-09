import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PillGroup } from '../components/ui';
import { inboxTime, previewText } from '../feature-module/agrilink/messaging/messaging';
import { messagingApi } from '../services/agrilink-messaging.service';
import type { ThreadSummary } from '../services/agrilink-messaging.types';
import { initials } from '../utils/initials';
import { useDropdown } from './useDropdown';

const PREVIEW_COUNT = 8;

/**
 * Nút tin nhắn dạng sổ xuống (kiểu Messenger): xem nhanh các cuộc trò chuyện,
 * lọc chưa đọc, đánh dấu đã đọc; "Xem tất cả" mở trang Tin nhắn đầy đủ.
 */
export default function AgriLinkMessagesMenu({
  side,
  unread,
  onChanged,
}: {
  side: 'buyer' | 'dealer';
  unread: number;
  /** Gọi sau khi đánh dấu đã đọc để header cập nhật số chưa đọc. */
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { open, setOpen, rootRef } = useDropdown();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = side === 'dealer' ? '/agrilink/quan-ly/tin-nhan' : '/agrilink/tin-nhan';

  const load = async () => {
    setError(false);
    try {
      setThreads(await messagingApi.threads({ as: side, kind: 'chat' }));
    } catch {
      setError(true);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const markAll = async () => {
    const pending = (threads ?? []).filter((t) => t.unread);
    if (busy || !pending.length) return;
    setBusy(true);
    try {
      await Promise.all(pending.map((t) => messagingApi.read(t.id)));
      setThreads((list) => list?.map((t) => ({ ...t, unread: false })) ?? null);
      onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const shown = (threads ?? []).filter((t) => !onlyUnread || t.unread).slice(0, PREVIEW_COUNT);
  const name = (t: ThreadSummary) => (side === 'buyer' ? t.dealerName || 'Đại lý' : t.buyerName);

  return (
    <div className="agrilink-notify" ref={rootRef}>
      <button
        type="button"
        className={`alh-circle${open ? ' is-open' : ''}`}
        aria-label={unread ? `Tin nhắn, ${unread} chưa đọc` : 'Tin nhắn'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <i className="ti ti-message-circle" aria-hidden="true" />
        {unread > 0 && <span className="alh-count">{unread > 99 ? '99+' : unread}</span>}
        {!open && (
          <span className="alh-tip" aria-hidden="true">
            Tin nhắn
          </span>
        )}
      </button>

      {open && (
        <div className="agrilink-notify-panel" role="dialog" aria-label="Tin nhắn">
          <div className="agrilink-notify-head">
            <strong>Tin nhắn</strong>
            <button type="button" className="btn btn-link btn-sm p-0" disabled={busy || unread === 0} onClick={() => void markAll()}>
              Đánh dấu tất cả đã đọc
            </button>
          </div>
          <PillGroup className="alh-drop-filter" role="group" aria-label="Lọc tin nhắn" activeKey={String(onlyUnread)}>
            <button type="button" className={onlyUnread ? '' : 'active'} aria-pressed={!onlyUnread} onClick={() => setOnlyUnread(false)}>
              Tất cả
            </button>
            <button type="button" className={onlyUnread ? 'active' : ''} aria-pressed={onlyUnread} onClick={() => setOnlyUnread(true)}>
              Chưa đọc{unread > 0 ? ` (${unread})` : ''}
            </button>
          </PillGroup>
          <div className="agrilink-notify-list">
            {error && !threads ? (
              <div className="agrilink-notify-empty">
                Không tải được tin nhắn.{' '}
                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => void load()}>
                  Thử lại
                </button>
              </div>
            ) : !threads ? (
              <div className="agrilink-notify-empty">Đang tải…</div>
            ) : !shown.length ? (
              <div className="agrilink-notify-empty">
                {onlyUnread ? 'Không có tin nhắn chưa đọc' : side === 'buyer' ? 'Chưa có cuộc trò chuyện — nhắn đại lý từ gian hàng' : 'Chưa có khách nhắn tin'}
              </div>
            ) : (
              shown.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`agrilink-notify-item alh-thread${t.unread ? ' unread' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    navigate(`${base}/${t.id}`);
                  }}
                >
                  <span className={`alh-thread-avatar${side === 'buyer' ? ' is-shop' : ''}`} aria-hidden="true">
                    {initials(name(t))}
                  </span>
                  <span className="agrilink-notify-body">
                    <span className="agrilink-notify-title">{name(t)}</span>
                    <span className="alh-thread-preview">{previewText(t, side)}</span>
                  </span>
                  <span className="alh-thread-time">{inboxTime(t.lastMessageAt)}</span>
                  <span className="agrilink-notify-dot" aria-hidden="true" />
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            className="agrilink-notify-footer"
            onClick={() => {
              setOpen(false);
              navigate(base);
            }}
          >
            Xem tất cả trong Tin nhắn
          </button>
        </div>
      )}
    </div>
  );
}
