import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader, SkeletonState } from '../../../components/ui';
import { apiError } from '../../../services/agrilink.service';
import { messagingApi, type ProposalInput, type ResolveInput } from '../../../services/agrilink-messaging.service';
import type { ThreadDetail, ThreadSide } from '../../../services/agrilink-messaging.types';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime } from '../../../utils/formatters';
import Conversation from './Conversation';
import { COMPLAINT_CATEGORY, COMPLAINT_STATUS, COMPLAINT_WISH, DEALER_PROPOSAL, RESOLUTION } from './messaging';
import './messaging.css';

const stepLabels = (viewer: ThreadSide, escalated: boolean) => [
  'Đã gửi',
  'Đại lý phản hồi',
  escalated ? 'AgriLink xem xét' : viewer === 'buyer' ? 'Bạn xác nhận' : 'Khách xác nhận',
  'Hoàn tất',
];

/** Bước đang diễn ra (1-based); 5 = đã xong hết. */
export function stepIndex(status: string): number {
  if (status === 'resolved') return 5;
  if (status === 'escalated' || status === 'dealer_replied') return 3;
  return 2; // open: đã gửi, đang chờ đại lý phản hồi
}

/** Thời gian còn lại trước khi tự chuyển AgriLink. */
export function timeLeft(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return 'sắp chuyển';
  const hours = Math.floor(ms / 3600000);
  return hours >= 24 ? `còn ${Math.floor(hours / 24)} ngày ${hours % 24} giờ` : `còn ${Math.max(1, hours)} giờ`;
}

function Steps({ thread, viewer }: { thread: ThreadDetail; viewer: ThreadSide }) {
  const current = stepIndex(thread.status);
  const labels = stepLabels(viewer, thread.status === 'escalated' || !!thread.escalatedAt);
  return (
    <div className="complaint-steps" aria-label="Tiến trình khiếu nại">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'now' : '';
        return (
          <Fragment key={label}>
            {i > 0 && <span className={`complaint-line${n <= current ? ' done' : ''}`} />}
            <span className={`complaint-step ${state}`}>
              <b>{state === 'done' ? <i className="ti ti-check" /> : n}</b>
              {label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function BuyerPanel({ thread, run }: { thread: ThreadDetail; run: (fn: () => Promise<ThreadDetail>, ok: string) => void }) {
  return (
    <>
      {thread.status === 'dealer_replied' && (
        <>
          <h2 className="h6">Bạn đồng ý với cách giải quyết?</h2>
          <p className="text-muted small">
            Đại lý đề xuất: <strong>{DEALER_PROPOSAL[thread.dealerProposal ?? 'other']}</strong>
          </p>
          <div className="d-grid gap-2">
            <button type="button" className="btn btn-primary" onClick={() => run(() => messagingApi.accept(thread.id), 'Đã đóng khiếu nại')}>
              Đồng ý, đã giải quyết
            </button>
            <button type="button" className="btn btn-outline-danger" onClick={() => run(() => messagingApi.escalate(thread.id), 'Đã chuyển AgriLink xem xét')}>
              Không đồng ý — chuyển AgriLink xem xét
            </button>
          </div>
        </>
      )}
      {thread.status === 'open' && thread.autoEscalateAt && (
        <div className="alert alert-warning mb-0">
          Đang chờ đại lý phản hồi. Nếu đại lý không phản hồi, khiếu nại tự chuyển lên AgriLink lúc{' '}
          <strong>{fmtDateTime(thread.autoEscalateAt)}</strong>.
        </div>
      )}
      {thread.status === 'escalated' && <div className="alert alert-info mb-0">AgriLink đang xem xét khiếu nại và sẽ thông báo kết quả cho bạn.</div>}
    </>
  );
}

function DealerPanel({ thread, run }: { thread: ThreadDetail; run: (fn: () => Promise<ThreadDetail>, ok: string) => void }) {
  const [proposal, setProposal] = useState<ProposalInput['proposal']>('exchange');
  const [note, setNote] = useState('');
  if (thread.status !== 'open' && thread.status !== 'dealer_replied') {
    return <p className="text-muted small mb-0">{thread.status === 'escalated' ? 'Khiếu nại đang được AgriLink xem xét. Bạn vẫn có thể nhắn để bổ sung thông tin.' : 'Khiếu nại đã đóng.'}</p>;
  }
  return (
    <>
      <h2 className="h6">Đề xuất cách giải quyết</h2>
      {thread.autoEscalateAt && (
        <p className="small">
          Hạn phản hồi: <span className="deadline">{timeLeft(thread.autoEscalateAt)}</span>
        </p>
      )}
      <div className="choice-chips" role="group" aria-label="Cách giải quyết">
        {Object.entries(DEALER_PROPOSAL).map(([key, label]) => (
          <button key={key} type="button" className={proposal === key ? 'active' : ''} aria-pressed={proposal === key} onClick={() => setProposal(key as ProposalInput['proposal'])}>
            {label}
          </button>
        ))}
      </div>
      <label className="form-label mt-3 mb-0 w-100">
        Ghi chú cho khách
        <textarea className="form-control mt-1" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: Chiều nay bên em mang bao mới đổi cho anh…" />
      </label>
      <button
        type="button"
        className="btn btn-primary mt-3"
        disabled={note.trim().length < 5}
        onClick={() => run(() => messagingApi.propose(thread.id, { proposal, note: note.trim() }), 'Đã gửi đề xuất cho khách')}
      >
        Gửi đề xuất
      </button>
      <p className="text-muted small mt-2 mb-0">Khách đồng ý → khiếu nại đóng. Khách không đồng ý → chuyển AgriLink.</p>
    </>
  );
}

function AdminPanel({ thread, run }: { thread: ThreadDetail; run: (fn: () => Promise<ThreadDetail>, ok: string) => void }) {
  const [resolution, setResolution] = useState<ResolveInput['resolution']>('settled');
  const [note, setNote] = useState('');
  if (thread.status !== 'escalated') return <p className="text-muted small mb-0">Khiếu nại đã đóng.</p>;
  return (
    <>
      <h2 className="h6">Quyết định</h2>
      <div className="choice-chips" role="group" aria-label="Kết luận">
        {(['buyer_favored', 'dealer_favored', 'settled'] as const).map((key) => (
          <button key={key} type="button" className={resolution === key ? 'active' : ''} aria-pressed={resolution === key} onClick={() => setResolution(key)}>
            {RESOLUTION[key]}
          </button>
        ))}
      </div>
      <label className="form-label mt-3 mb-0 w-100">
        Ghi chú (bắt buộc)
        <textarea className="form-control mt-1" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button
        type="button"
        className="btn btn-primary mt-3"
        disabled={note.trim().length < 5}
        onClick={() => run(() => messagingApi.resolve(thread.id, { resolution, note: note.trim() }), 'Đã đóng khiếu nại')}
      >
        Đóng khiếu nại
      </button>
      <p className="text-muted small mt-2 mb-0">Cả nông dân và đại lý nhận thông báo kết quả.</p>
    </>
  );
}

/** Chi tiết khiếu nại — dùng cho nông dân, đại lý và quản trị. */
export default function ComplaintPage({
  viewer,
  threadId,
  onChanged,
}: {
  viewer: ThreadSide;
  threadId?: string;
  /** Báo cho trang chứa (vd. hàng đợi quản trị) tải lại danh sách. */
  onChanged?: () => void;
}) {
  const params = useParams();
  const id = threadId ?? params.id ?? '';
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    messagingApi
      .thread(id)
      .then((t) => {
        setThread(t);
        setError('');
      })
      .catch((e) => setError(apiError(e)));
  }, [id]);
  useEffect(() => {
    if (id) load();
  }, [id, load]);

  const run = (fn: () => Promise<ThreadDetail>, ok: string) => {
    if (busy) return;
    setBusy(true);
    fn()
      .then(() => {
        showToast('success', ok);
        load();
        onChanged?.();
        setRefreshKey((k) => k + 1);
      })
      .catch((e) => showToast('error', apiError(e)))
      .finally(() => setBusy(false));
  };

  if (!thread) return error ? <p className="text-danger">{error}</p> : <SkeletonState variant="detail" />;
  const status = COMPLAINT_STATUS[thread.status] ?? { label: thread.status, tone: 'bg-secondary' };
  const orderPath = viewer === 'dealer' ? `/agrilink/quan-ly/don/${thread.orderId}` : viewer === 'buyer' ? `/agrilink/don-cua-toi/${thread.orderId}` : null;

  return (
    <div className="messages-page">
      <PageHeader
        title={`Khiếu nại ${thread.code}`}
        subtitle={`${thread.subject} · ${viewer === 'buyer' ? thread.dealerName : thread.buyerName} · gửi ${fmtDateTime(thread.createdAt)}`}
        actions={<span className={`badge ${status.tone}`}>{status.label}</span>}
      />
      <div className="complaint-grid">
        <div className="card complaint-conv">
          <Conversation
            thread={thread}
            viewer={viewer}
            refreshKey={refreshKey}
            onActivity={load}
            header={<Steps thread={thread} viewer={viewer} />}
            placeholder={viewer === 'dealer' ? 'Phản hồi khách…' : viewer === 'admin' ? 'Nhắn cho cả hai bên…' : 'Trả lời đại lý…'}
            disabledReason={thread.status === 'resolved' ? 'Khiếu nại đã đóng.' : null}
          />
        </div>
        <aside className="card p-3" aria-busy={busy}>
          {viewer === 'buyer' && <BuyerPanel thread={thread} run={run} />}
          {viewer === 'dealer' && <DealerPanel thread={thread} run={run} />}
          {viewer === 'admin' && <AdminPanel thread={thread} run={run} />}
          {thread.status === 'resolved' && thread.resolution && (
            <div className="complaint-result mt-3">
              <strong>Kết quả: {RESOLUTION[thread.resolution]}</strong>
              {thread.resolutionNote && <p>{thread.resolutionNote}</p>}
            </div>
          )}
          <dl className="complaint-facts">
            <dt>Vấn đề</dt>
            <dd>{COMPLAINT_CATEGORY[thread.category ?? 'other']}</dd>
            {thread.buyerWish && (
              <>
                <dt>Mong muốn</dt>
                <dd>{COMPLAINT_WISH[thread.buyerWish]}</dd>
              </>
            )}
            <dt>Đơn</dt>
            <dd>{orderPath ? <Link to={orderPath}>{thread.orderCode}</Link> : thread.orderCode}</dd>
            <dt>Nông dân</dt>
            <dd>{thread.buyerName}</dd>
            <dt>Đại lý</dt>
            <dd>{thread.dealerName}</dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
