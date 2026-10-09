import { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageHeader, PillGroup, SkeletonState } from '../../../components/ui';
import { apiError } from '../../../services/agrilink.service';
import { messagingApi } from '../../../services/agrilink-messaging.service';
import type { ThreadDetail, ThreadStatus, ThreadSummary } from '../../../services/agrilink-messaging.types';
import { fmtDateTime } from '../../../utils/formatters';
import { showToast } from '../../../stores/toastStore';
import ComplaintPage from './ComplaintPage';
import Conversation from './Conversation';
import { COMPLAINT_CATEGORY, COMPLAINT_STATUS, SUPPORT_CATEGORY, SUPPORT_STATUS } from './messaging';
import './messaging.css';

type Tab = { kind: 'complaint' | 'support'; status?: ThreadStatus; label: string };
const TABS: Tab[] = [
  { kind: 'complaint', status: 'escalated', label: 'Khiếu nại chuyển lên' },
  { kind: 'support', status: 'open', label: 'Yêu cầu hỗ trợ' },
  { kind: 'complaint', status: 'resolved', label: 'Khiếu nại đã giải quyết' },
  { kind: 'support', status: 'answered', label: 'Hỗ trợ đã trả lời' },
];

function SupportDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    messagingApi.thread(id).then(setThread).catch(() => setThread(null));
  }, [id]);
  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await messagingApi.close(id);
      showToast('success', 'Đã đóng yêu cầu');
      onChanged();
    } catch (e) {
      showToast('error', apiError(e));
    } finally {
      setClosing(false);
    }
  };
  if (!thread) return <SkeletonState variant="detail" />;
  return (
    <div className="card complaint-conv">
      <Conversation
        thread={thread}
        viewer="admin"
        placeholder="Trả lời người dùng…"
        header={
          <div className="conv-head">
            <div className="conv-head-main">
              <strong>
                {thread.code} · {thread.subject}
              </strong>
              <small>
                {thread.buyerName} · {SUPPORT_CATEGORY[thread.category ?? 'other']} · {fmtDateTime(thread.createdAt)}
              </small>
            </div>
            {thread.status !== 'closed' && (
              <button type="button" className="btn btn-sm btn-outline-secondary" disabled={closing} onClick={() => void close()}>
                Đóng yêu cầu
              </button>
            )}
          </div>
        }
        disabledReason={thread.status === 'closed' ? 'Yêu cầu đã đóng.' : null}
      />
    </div>
  );
}

/** Quản trị · Khiếu nại & hỗ trợ. */
export default function AdminThreadsPage() {
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<ThreadSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const current = TABS[tab];

  const load = useCallback(() => {
    messagingApi
      .adminThreads(current.kind, current.status)
      .then((data) => {
        setError('');
        setRows(data);
        setSelected((id) => (id && data.some((t) => t.id === id) ? id : (data[0]?.id ?? null)));
      })
      .catch((e) => setError(e?.response?.status === 403 ? 'Bạn không có quyền quản trị nền tảng' : apiError(e)));
  }, [current.kind, current.status]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader title="Khiếu nại & hỗ trợ" subtitle="Khiếu nại đã chuyển lên AgriLink và yêu cầu hỗ trợ từ người dùng." />
      <PillGroup className="inbox-filter mb-3" role="group" aria-label="Hàng đợi" activeKey={String(tab)}>
        {TABS.map((t, i) => (
          <button key={t.label} type="button" className={tab === i ? 'active' : ''} aria-pressed={tab === i} onClick={() => setTab(i)}>
            {t.label}
          </button>
        ))}
      </PillGroup>
      {error ? (
        <p className="text-danger">{error}</p>
      ) : !rows ? (
        <SkeletonState variant="table" rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState title="Không có mục nào" />
      ) : (
        <div className="admin-threads">
          <aside className="card p-2">
            {rows.map((t) => {
              const s = (current.kind === 'complaint' ? COMPLAINT_STATUS : SUPPORT_STATUS)[t.status] ?? { label: t.status, tone: 'bg-secondary' };
              return (
                <button key={t.id} type="button" className={`thread-row w-100 text-start bg-transparent${selected === t.id ? ' border-primary' : ''}`} onClick={() => setSelected(t.id)}>
                  <span>
                    <strong>
                      {t.code} · {current.kind === 'complaint' ? COMPLAINT_CATEGORY[t.category ?? 'other'] : t.subject}
                    </strong>
                    <small>{current.kind === 'complaint' ? `${t.buyerName} ↔ ${t.dealerName}` : t.buyerName}</small>
                  </span>
                  <span className={`badge ${s.tone}`}>{s.label}</span>
                </button>
              );
            })}
          </aside>
          <div>
            {selected &&
              (current.kind === 'complaint' ? (
                <ComplaintPage key={selected} viewer="admin" threadId={selected} onChanged={load} />
              ) : (
                <SupportDetail key={selected} id={selected} onChanged={load} />
              ))}
          </div>
        </div>
      )}
    </>
  );
}
