import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, MoneyText, PageHeader, PillGroup, SkeletonState } from '../../../components/ui';
import { agrilinkBuyerApi, apiError } from '../../../services/agrilink.service';
import type { OrderStatus, OrderSummary } from '../../../services/agrilink.types';
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
export default function MyOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    agrilinkBuyerApi
      .myOrders(status === 'all' ? undefined : status)
      .then((data) => {
        if (active) {
          setOrders(data);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(apiError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status]);
  return (
    <>
      <PageHeader title="Đơn của tôi" subtitle="Theo dõi đơn mua vật tư và bán nông sản" />
      <PillGroup className="agl-status-filter mb-4" role="group" aria-label="Lọc theo trạng thái" activeKey={status}>
        {statuses.map((x) => (
          <button
            type="button"
            key={x}
            className={x === status ? 'active' : ''}
            aria-pressed={x === status}
            onClick={() => setStatus(x)}
          >
            {x === 'all' ? 'Tất cả' : statusLabels[x]}
          </button>
        ))}
      </PillGroup>
      {error && <p className="text-danger">{error}</p>}
      {loading && !orders.length ? (
        <SkeletonState variant="cards" count={3} />
      ) : orders.length ? (
        <div className="d-grid gap-3 agri-reveal">
          {orders.map((order) => (
            <Link
              to={`/agrilink/don-cua-toi/${order.id}`}
              className="card text-decoration-none text-reset"
              key={order.id}
            >
              <div className="card-body p-3">
                <div className="d-flex justify-content-between gap-2 mb-2">
                  <strong>{order.code}</strong>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="mb-1">
                  {order.dealer?.name || 'Đại lý'} · {kindLabels[order.kind]} · {order.itemCount}{' '}
                  dòng hàng
                </p>
                <div className="d-flex justify-content-between">
                  <span>
                  <MoneyText value={Math.round(orderPayable(order))} />
                    {order.finalTotal != null && <small className="text-muted ms-2">Đã chốt</small>}
                  </span>
                  <small className="text-muted">{fmtDateTime(order.createdAt)}</small>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="Chưa có đơn hàng" description="Các đơn bạn đặt sẽ hiển thị ở đây." />
      )}
    </>
  );
}
