import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, PageHeader, PillGroup, SkeletonState } from '../../../components/ui';
import { apiError } from '../../../services/agrilink.service';
import { messagingApi } from '../../../services/agrilink-messaging.service';
import type { ThreadStatus, ThreadSummary } from '../../../services/agrilink-messaging.types';
import ComplaintPage, { timeLeft } from './ComplaintPage';
import { COMPLAINT_CATEGORY, COMPLAINT_STATUS } from './messaging';
import './messaging.css';

const AUTO_ESCALATE_MS = 72 * 3600000;
const FILTERS: { value: ThreadStatus; label: string }[] = [
  { value: 'open', label: 'Cần xử lý' },
  { value: 'dealer_replied', label: 'Chờ khách xác nhận' },
  { value: 'escalated', label: 'Đã chuyển AgriLink' },
  { value: 'resolved', label: 'Đã giải quyết' },
];

export default function DealerComplaintsPage() {
  const { id } = useParams();
  const [status, setStatus] = useState<ThreadStatus>('open');
  const [rows, setRows] = useState<ThreadSummary[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    messagingApi
      .threads({ as: 'dealer', kind: 'complaint', status })
      .then(setRows)
      .catch((e) => setError(apiError(e)));
  }, [status]);
  useEffect(() => {
    if (!id) load();
  }, [id, load]);

  if (id) {
    return (
      <>
        <Link to="/agrilink/quan-ly/khieu-nai" className="btn btn-sm btn-outline-secondary mb-3">
          <i className="ti ti-arrow-left me-1" />
          Danh sách khiếu nại
        </Link>
        <ComplaintPage viewer="dealer" threadId={id} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Khiếu nại" subtitle="Giải quyết trong 3 ngày để khiếu nại không bị chuyển lên AgriLink." />
      <PillGroup className="inbox-filter mb-3" role="group" aria-label="Lọc khiếu nại" activeKey={status}>
        {FILTERS.map((f) => (
          <button key={f.value} type="button" className={status === f.value ? 'active' : ''} aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
            {f.label}
          </button>
        ))}
      </PillGroup>
      {error && <p className="text-danger">{error}</p>}
      {!rows ? (
        <SkeletonState variant="table" rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState title="Không có khiếu nại" description="Khiếu nại của khách về đơn hàng sẽ hiện ở đây." />
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Đơn</th>
                  <th>Khách</th>
                  <th>Vấn đề</th>
                  <th>Trạng thái</th>
                  <th>Hạn xử lý</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const s = COMPLAINT_STATUS[t.status] ?? { label: t.status, tone: 'bg-secondary' };
                  const deadline =
                    t.status === 'open' ? new Date(new Date(t.createdAt).getTime() + AUTO_ESCALATE_MS).toISOString() : null;
                  return (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.code}</strong>
                        {t.unread && <span className="inbox-dot d-inline-block ms-2" aria-label="Có tin mới" />}
                      </td>
                      <td>{t.orderCode}</td>
                      <td>{t.buyerName}</td>
                      <td>{COMPLAINT_CATEGORY[t.category ?? 'other']}</td>
                      <td>
                        <span className={`badge ${s.tone}`}>{s.label}</span>
                      </td>
                      <td>{deadline ? <span className="deadline">{timeLeft(deadline)}</span> : <span className="text-muted">—</span>}</td>
                      <td className="text-end">
                        <Link className={`btn btn-sm ${t.status === 'open' ? 'btn-primary' : 'btn-outline-primary'}`} to={`/agrilink/quan-ly/khieu-nai/${t.id}`}>
                          {t.status === 'open' ? 'Xử lý' : 'Xem'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
