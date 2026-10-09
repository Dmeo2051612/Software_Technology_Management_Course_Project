import { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonState } from '../../../components/ui';
import { agrilinkPlatformApi, apiError } from '../../../services/agrilink.service';
import type { PlatformVerification, Verification } from '../../../services/agrilink.types';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime } from '../../../utils/formatters';
import './dealerPages.css';

type StatusFilter = Verification['status'] | '';
type Action = 'approve' | 'reject' | 'revoke';
const labels: Record<Verification['status'], string> = { pending: 'Chờ duyệt', verified: 'Đã xác minh', rejected: 'Từ chối' };
export default function AdminVerificationPage() {
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [items, setItems] = useState<PlatformVerification[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<{ item: PlatformVerification; action: Action } | null>(null);
  const [note, setNote] = useState('');
  const refresh = useCallback(async () => {
    try { setItems(await agrilinkPlatformApi.verifications(status || undefined)); setForbidden(false); setError(''); }
    catch (e) { if ((e as { response?: { status?: number } })?.response?.status === 403) setForbidden(true); else setError(apiError(e)); }
  }, [status]);
  useEffect(() => { void refresh(); }, [refresh]);
  const decide = async () => {
    if (busy || !decision) return;
    if (decision.action !== 'approve' && !note.trim()) { setError('Cần ghi chú khi từ chối hoặc thu hồi.'); return; }
    setBusy(true);
    try {
      await agrilinkPlatformApi.decide(decision.item.organizationId, decision.action, note.trim() || undefined);
      setDecision(null); setNote(''); await refresh(); showToast('success', 'Đã cập nhật hồ sơ xác minh');
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  return <>
    <PageHeader title="Duyệt xác minh" subtitle="Quản trị hồ sơ xác minh của đại lý AgriLink." />
    {forbidden ? <div className="alert alert-danger">Bạn không có quyền quản trị nền tảng</div> : <>
      <div className="btn-group mb-3" role="group" aria-label="Trạng thái hồ sơ">{([['pending', 'Chờ duyệt'], ['verified', 'Đã xác minh'], ['rejected', 'Từ chối'], ['', 'Tất cả']] as const).map(([value, label]) => <button key={value} className={`btn ${status === value ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setStatus(value)}>{label}</button>)}</div>
      {error && <p className="text-danger">{error}</p>}
      {!items ? <SkeletonState variant="table" rows={5} /> : items.length === 0 ? <EmptyState title="Không có hồ sơ" /> : <div className="card">
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th>Đại lý</th>
                <th>Pháp lý</th>
                <th>Mã số thuế</th>
                <th>Địa chỉ</th>
                <th>Gửi lúc</th>
                <th>Trạng thái</th>
                <th>
                </th>
              </tr>
            </thead>
            <tbody>{items.map((item) => <tr key={item.organizationId}>
              <td>
                <strong>{item.organizationName}</strong>
                <small className="d-block text-muted">{item.provinceName}</small>
              </td>
              <td>{item.legalName}</td>
              <td>{item.taxCode}</td>
              <td>{item.businessAddress}</td>
              <td>{fmtDateTime(item.submittedAt)}</td>
              <td>
                <span className={`badge ${item.status === 'verified' ? 'bg-success' : item.status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'}`}>{labels[item.status]}</span>
              </td>
              <td>
                <div className="d-flex gap-1">{item.status === 'pending' && <>
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setDecision({ item, action: 'approve' })}>Duyệt</button>
                  <button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => setDecision({ item, action: 'reject' })}>Từ chối</button>
                </>}{item.status === 'verified' && <button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => setDecision({ item, action: 'revoke' })}>Thu hồi</button>}</div>
              </td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
      {decision && <div className="agrilink-drawer-backdrop" onMouseDown={() => !busy && setDecision(null)}>
        <section className="agrilink-drawer" role="dialog" aria-modal="true" aria-label="Quyết định xác minh" onMouseDown={(event) => event.stopPropagation()}>
          <h2 className="h5">{decision.action === 'approve' ? 'Duyệt' : decision.action === 'reject' ? 'Từ chối' : 'Thu hồi'} xác minh</h2>
          <p>{decision.item.organizationName}</p>
          <label className="form-label d-block">Ghi chú {decision.action !== 'approve' && '(bắt buộc)'}<textarea className="form-control" rows={4} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error && <p className="text-danger" role="alert">{error}</p>}
          <div className="d-flex gap-2 mt-3">
            <button className="btn btn-primary" disabled={busy || (decision.action !== 'approve' && !note.trim())} onClick={() => void decide()}>Xác nhận</button>
            <button className="btn btn-outline-secondary" disabled={busy} onClick={() => { setDecision(null); setNote(''); }}>Hủy</button>
          </div>
        </section>
      </div>}
    </>}
  </>;
}
