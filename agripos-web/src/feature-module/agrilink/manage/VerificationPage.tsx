import { useEffect, useState } from 'react';
import { PageHeader, SkeletonState } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { Verification } from '../../../services/agrilink.types';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime } from '../../../utils/formatters';

const statusLabel = { pending: 'Đang chờ duyệt', verified: 'Đã xác minh', rejected: 'Cần gửi lại' };
function validTaxCode(value: string) {
  const digits = value.length === 10 ? value : value.length === 14 && value[10] === '-' ? value.slice(0, 10) + value.slice(11) : '';
  return digits.length === (value.length === 10 ? 10 : 13) && [...digits].every((char) => char >= '0' && char <= '9');
}
export default function VerificationPage() {
  const [status, setStatus] = useState<Verification | null | undefined>(undefined);
  const [legalName, setLegalName] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void agrilinkManageApi.verification().then((result) => { setStatus(result); if (result) { setLegalName(result.legalName); setTaxCode(result.taxCode); setBusinessAddress(result.businessAddress); } }).catch((e) => setError(apiError(e)));
  }, []);
  const submit = async () => {
    if (busy) return;
    if (!legalName.trim() || !businessAddress.trim() || !validTaxCode(taxCode.trim())) {
      setError('Nhập tên pháp lý, địa chỉ kinh doanh và mã số thuế 10 số hoặc 10-3 số.'); return;
    }
    setBusy(true);
    try {
      const result = await agrilinkManageApi.submitVerification({ legalName: legalName.trim(), taxCode: taxCode.trim(), businessAddress: businessAddress.trim() });
      setStatus(result); setError(''); showToast('success', 'Đã gửi hồ sơ xác minh');
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  return <>
    <PageHeader title="Xác minh đại lý" subtitle="Gửi thông tin pháp lý để người mua nhận biết đại lý đã được kiểm duyệt." />
    {error && <p className="text-danger">{error}</p>}
    {status === undefined ? <SkeletonState variant="detail" /> : <div className="row g-4">
      <div className="col-lg-5">
        <div className="card">
          <div className="card-body p-4">
            <h2 className="h5">Trạng thái xác minh</h2>
            <span className={`badge ${status?.status === 'verified' ? 'bg-success' : status?.status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'}`}>{status ? statusLabel[status.status] : 'Chưa gửi hồ sơ'}</span>{status?.submittedAt && <p className="text-muted mt-3 mb-1">Gửi lúc {fmtDateTime(status.submittedAt)}</p>}{status?.note && <p className="mt-3 mb-0">Ghi chú: {status.note}</p>}</div>
        </div>
      </div>
      <div className="col-lg-7">
        <div className="card">
          <div className="card-body p-4">
            <h2 className="h5 mb-3">Thông tin doanh nghiệp</h2>
            <p className="text-muted">Mã số thuế được kiểm tra theo định dạng; việc duyệt do quản trị viên thực hiện.</p>
            <label className="form-label d-block">Tên pháp lý<input className="form-control" maxLength={200} disabled={busy || status?.status === 'pending' || status?.status === 'verified'} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </label>
            <label className="form-label d-block">Mã số thuế<input className="form-control" maxLength={14} disabled={busy || status?.status === 'pending' || status?.status === 'verified'} value={taxCode} onChange={(e) => setTaxCode(e.target.value)} placeholder="0123456789 hoặc 0123456789-001" />
            </label>
            <label className="form-label d-block">Địa chỉ kinh doanh<textarea className="form-control" maxLength={300} rows={3} disabled={busy || status?.status === 'pending' || status?.status === 'verified'} value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} />
            </label>
            {(!status || status.status === 'rejected') && <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{status ? 'Gửi lại hồ sơ' : 'Gửi hồ sơ xác minh'}</button>}
          </div>
        </div>
      </div>
    </div>}
  </>;
}
