import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, MoneyText, PageHeader, PillGroup, SkeletonState } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { OrderKind, OrderStatus, OrdersPageData } from '../../../services/agrilink.types';
import { fmtDateTime } from '../../../utils/formatters';
import OrderStatusBadge from '../components/OrderStatusBadge';
import { kindLabels, statusLabels } from '../labels';
import { orderPayable } from '../voucher';

const statuses: (OrderStatus | 'all')[] = [
  'all',
  'pending',
  'confirmed',
  'delivering',
  'completed',
  'rejected',
  'cancelled',
];
export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') || 'all') as OrderStatus | 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const kind = (params.get('kind') || '') as OrderKind | '';
  const [q, setQ] = useState(params.get('q') || '');
  const [debounced, setDebounced] = useState(q);
  const [data, setData] = useState<OrdersPageData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q), 300);
    return () => window.clearTimeout(timer);
  }, [q]);
  const load = useCallback(() => {
    agrilinkManageApi
      .orders({
        ...(status === 'all' ? {} : { status }),
        ...(kind ? { kind } : {}),
        ...(debounced ? { q: debounced } : {}),
        page,
        limit: 20,
      })
      .then((x) => {
        setData(x);
        setError('');
      })
      .catch((e) => setError(apiError(e)));
  }, [status, kind, debounced, page]);
  useEffect(() => {
    load();
    const interval = window.setInterval(load, 60000);
    return () => window.clearInterval(interval);
  }, [load]);
  const change = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch))
      if (value) next.set(key, value);
      else next.delete(key);
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return (
    <>
      <PageHeader title="Đơn hàng AgriLink" subtitle="Xử lý đơn mua vật tư và bán nông sản" />
      <PillGroup className="agl-status-filter mb-3" role="group" aria-label="Lọc theo trạng thái" activeKey={status}>
        {statuses.map((x) => (
          <button
            type="button"
            key={x}
            className={x === status ? 'active' : ''}
            aria-pressed={x === status}
            onClick={() => change({ status: x === 'all' ? '' : x })}
          >
            {x === 'all' ? 'Tất cả' : statusLabels[x]}{' '}
            {x !== 'all' && data?.counts[x] != null && `(${data.counts[x]})`}
          </button>
        ))}
      </PillGroup>
      <div className="d-flex gap-2 mb-3 flex-wrap">
        <select
          className="form-select w-auto"
          value={kind}
          onChange={(e) => change({ kind: e.target.value })}
          aria-label="Lọc loại đơn"
        >
          <option value="">Tất cả loại</option>
          <option value="buy">Mua vật tư</option>
          <option value="sell">Bán nông sản</option>
        </select>
        <input
          className="form-control flex-grow-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã đơn, tên, SĐT"
          aria-label="Tìm đơn"
        />
      </div>
      {error && <p className="text-danger">{error}</p>}
      {!data ? (
        <SkeletonState variant="table" rows={5} />
      ) : data.items.length ? (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Người mua / SĐT</th>
                  <th>Loại</th>
                  <th>Số dòng</th>
                  <th>Tạm tính / Chốt</th>
                  <th>Trạng thái</th>
                  <th>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link to={`/agrilink/quan-ly/don/${order.id}`}>{order.code}</Link>
                    </td>
                    <td>
                      {order.contactName}
                      <small className="d-block text-muted">{order.contactPhone}</small>
                    </td>
                    <td>{kindLabels[order.kind]}</td>
                    <td>{order.itemCount}</td>
                    <td>
                      <MoneyText value={Math.round(orderPayable(order))} />
                    </td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td>{fmtDateTime(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState title="Không có đơn phù hợp" />
      )}
      {data && data.total > 20 && (
        <div className="d-flex justify-content-end align-items-center gap-2 mt-3">
          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => change({ page: String(page - 1) })}
          >
            Trước
          </button>
          <span>
            Trang {page} / {Math.ceil(data.total / 20)}
          </span>
          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= Math.ceil(data.total / 20)}
            onClick={() => change({ page: String(page + 1) })}
          >
            Sau
          </button>
        </div>
      )}
    </>
  );
}
