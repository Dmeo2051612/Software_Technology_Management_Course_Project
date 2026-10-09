import { useEffect, useState } from 'react';
import { EmptyState, MoneyText, PageHeader, SkeletonState, StatCard } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { ManagedVoucher, VoucherState, VouchersPageData } from '../../../services/agrilink.types';
import { showToast } from '../../../stores/toastStore';
import { fmtVND } from '../../../utils/formatters';
import { vnDayMonth, voucherStateLabels } from '../voucher';
import VoucherDrawer from './VoucherDrawer';
import './dealerPages.css';

type Filter = 'all' | 'running' | 'scheduled' | 'done';
const FILTERS: [Filter, string][] = [
  ['all', 'Tất cả'],
  ['running', 'Đang chạy'],
  ['scheduled', 'Sắp diễn ra'],
  ['done', 'Đã kết thúc'],
];
const inFilter = (state: VoucherState, filter: Filter) =>
  filter === 'all' || (filter === 'done' ? !['running', 'scheduled'].includes(state) : state === filter);

function discountLabel(v: ManagedVoucher) {
  return v.type === 'amount' ? fmtVND(v.value) : `${v.value}% · tối đa ${fmtVND(v.maxDiscount ?? 0)}`;
}

export default function VouchersPage() {
  const [data, setData] = useState<VouchersPageData | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ManagedVoucher | 'new' | null>(null);
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    agrilinkManageApi
      .vouchers()
      .then((res) => {
        if (!active) return;
        setData(res);
        setError('');
      })
      .catch((e) => {
        if (active) setError(apiError(e));
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const act = async (v: ManagedVoucher, run: () => Promise<unknown>, done: string) => {
    setBusy(v.id);
    try {
      await run();
      showToast('success', done);
      setReload((x) => x + 1);
    } catch (e) {
      showToast('error', apiError(e));
    } finally {
      setBusy('');
    }
  };

  const items = data?.items ?? [];
  const needle = q.trim().toLocaleLowerCase('vi');
  const shown = items.filter(
    (v) => inFilter(v.state, filter) && (!needle || v.title.toLocaleLowerCase('vi').includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="Voucher"
        subtitle="Tặng mã giảm giá cho đơn mua vật tư trên AgriLink. Khách lưu ở gian hàng và chọn khi đặt đơn."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <i className="ti ti-plus me-1" aria-hidden="true" />
            Tạo voucher
          </button>
        }
      />
      {error && <p className="text-danger">{error}</p>}
      {!data ? (
        <SkeletonState variant="table" rows={4} />
      ) : (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-4">
              <StatCard label="Đang chạy" value={data.stats.running} icon="ticket" />
            </div>
            <div className="col-md-4">
              <StatCard label="Lượt đã dùng (30 ngày)" value={data.stats.used30d} icon="receipt" iconColor="success" />
            </div>
            <div className="col-md-4">
              <StatCard
                label="Tổng tiền đã giảm (30 ngày)"
                value={<MoneyText value={data.stats.discount30d} />}
                icon="discount"
                iconColor="warning"
              />
            </div>
          </div>
          <div className="card">
            <div className="d-flex flex-wrap align-items-center gap-2 p-3 border-bottom">
              <div className="btn-group" role="group" aria-label="Lọc voucher">
                {FILTERS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`btn btn-sm ${filter === key ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setFilter(key)}
                  >
                    {label} ({items.filter((v) => inFilter(v.state, key)).length})
                  </button>
                ))}
              </div>
              <input
                className="form-control form-control-sm ms-auto"
                style={{ maxWidth: 260 }}
                placeholder="Tìm theo tên voucher"
                aria-label="Tìm voucher"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {shown.length ? (
              <div className="table-responsive">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Voucher</th>
                      <th>Mức giảm</th>
                      <th>Đơn tối thiểu</th>
                      <th>Đã dùng</th>
                      <th>Thời gian</th>
                      <th>Trạng thái</th>
                      <th className="text-end">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((v) => {
                      const state = voucherStateLabels[v.state];
                      const canStop = v.active && v.state !== 'ended';
                      const canResume = !v.active && new Date(v.endsAt) > new Date();
                      return (
                        <tr key={v.id}>
                          <td>
                            <strong className="d-block">{v.title}</strong>
                            <small className="text-muted">
                              {v.savedCount ? `Đã lưu: ${v.savedCount} khách` : 'Chưa ai lưu'}
                            </small>
                          </td>
                          <td>{discountLabel(v)}</td>
                          <td>{v.minOrder ? <MoneyText value={v.minOrder} /> : 'Không'}</td>
                          <td>
                            {v.usedCount} / {v.quantity}
                            <div className="voucher-progress" aria-hidden="true">
                              <i style={{ width: `${Math.min(100, (v.usedCount / v.quantity) * 100)}%` }} />
                            </div>
                          </td>
                          <td className="text-nowrap">
                            {vnDayMonth(v.startsAt)} – {vnDayMonth(v.endsAt)}
                          </td>
                          <td>
                            <span className={`voucher-state is-${state.tone}`}>{state.label}</span>
                          </td>
                          <td>
                            <div className="d-flex justify-content-end gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                aria-label={`Sửa ${v.title}`}
                                onClick={() => setEditing(v)}
                              >
                                <i className="ti ti-pencil" aria-hidden="true" />
                              </button>
                              {canStop && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary"
                                  disabled={busy === v.id}
                                  onClick={() =>
                                    void act(v, () => agrilinkManageApi.updateVoucher(v.id, { active: false }), 'Đã dừng voucher')
                                  }
                                >
                                  <i className="ti ti-player-pause me-1" aria-hidden="true" />
                                  Dừng
                                </button>
                              )}
                              {canResume && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary"
                                  disabled={busy === v.id}
                                  onClick={() =>
                                    void act(v, () => agrilinkManageApi.updateVoucher(v.id, { active: true }), 'Đã chạy lại voucher')
                                  }
                                >
                                  <i className="ti ti-player-play me-1" aria-hidden="true" />
                                  Chạy lại
                                </button>
                              )}
                              {/* Đã gắn với đơn (kể cả đơn huỷ) thì chỉ dừng được, không xoá. */}
                              {v.usedCount === 0 && !v.hasOrders && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  aria-label={`Xoá ${v.title}`}
                                  disabled={busy === v.id}
                                  onClick={() => {
                                    if (window.confirm(`Xoá voucher "${v.title}"?`))
                                      void act(v, () => agrilinkManageApi.removeVoucher(v.id), 'Đã xoá voucher');
                                  }}
                                >
                                  <i className="ti ti-trash" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={items.length ? 'Không có voucher phù hợp' : 'Chưa có voucher'}
                action={
                  !items.length && (
                    <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
                      Tạo voucher đầu tiên
                    </button>
                  )
                }
              />
            )}
          </div>
          <p className="text-muted small mt-2">
            Voucher đã có người dùng thì chỉ sửa được tên, số lượt và ngày kết thúc; muốn ngừng thì bấm "Dừng". Voucher
            chưa gắn với đơn nào mới xoá được.
          </p>
        </>
      )}
      {editing && (
        <VoucherDrawer
          key={editing === 'new' ? 'new' : editing.id}
          voucher={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            showToast('success', editing === 'new' ? 'Đã tạo voucher' : 'Đã lưu voucher');
            setEditing(null);
            setReload((x) => x + 1);
          }}
        />
      )}
    </>
  );
}
