import { useCanSeeFinance } from "../../../stores/financeStore";
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { EmptyState, MoneyText, PageHeader, SkeletonState } from '../../../components/ui';
import iconPending from '../../../assets/img/fluent-color/clock-48.svg';
import iconProgress from '../../../assets/img/fluent-color/send-clock-32.svg';
import iconRate from '../../../assets/img/fluent-color/data-pie-32.svg';
import iconRevenue from '../../../assets/img/fluent-color/coin-multiple-48.svg';
import iconAlarm from '../../../assets/img/fluent-color/clock-alarm-48.svg';
import './overview.css';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { BuyOffer, ManageStats, OrderSummary } from '../../../services/agrilink.types';
import { useAuthStore } from '../../../stores/authStore';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime, fmtKg } from '../../../utils/formatters';
import OrderStatusBadge from '../components/OrderStatusBadge';
import { orderPayable } from '../voucher';

type Period = '7' | '30' | 'month';

/** Ô số liệu AgriLink: icon màu (Fluent Color) trên nền tint, số lớn. */
function OverviewStat({ label, value, icon, tone, note }: { label: string; value: ReactNode; icon: string; tone: string; note?: ReactNode }) {
  return (
    <div className="agl-stat card h-100" data-tone={tone}>
      <span className="agl-stat-icon"><img src={icon} alt="" /></span>
      <div className="agl-stat-body">
        <span className="agl-stat-label">{label}</span>
        <strong className="agl-stat-value">{value}</strong>
        {note && <small className="agl-stat-note">{note}</small>}
      </div>
    </div>
  );
}
export function periodBounds(period: Period, now = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'month') start.setDate(1);
  else start.setDate(start.getDate() - Number(period) + 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}
export default function OverviewPage() {
  const role = useAuthStore((s) => s.user?.role);
  // Doanh thu / giá trị chỉ hiện với người được chủ cho xem tài chính.
  const canSeeFinance = useCanSeeFinance();
  const [period, setPeriod] = useState<Period>('7');
  const [stats, setStats] = useState<ManageStats | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [offers, setOffers] = useState<BuyOffer[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    // Thu ngân được chuyển sang trang đơn — không gọi thống kê (API trả 403).
    if (role === 'cashier') return;
    let active = true;
    const { from, to } = periodBounds(period);
    Promise.all([agrilinkManageApi.stats(from, to), agrilinkManageApi.orders({ limit: 5 })])
      .then(([s, o]) => {
        if (active) {
          setStats(s);
          setOrders(o.items);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(apiError(e));
      });
    return () => {
      active = false;
    };
  }, [period, role]);
  useEffect(() => {
    if (role === 'cashier') return;
    void agrilinkManageApi.buyOffers().then(setOffers).catch((e) => setError(apiError(e)));
  }, [role]);
  if (role === 'cashier') return <Navigate to="/agrilink/quan-ly/don" replace />;
  const confirm = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await agrilinkManageApi.confirm(id);
      setOrders((items) => items.map((x) => (x.id === id ? { ...x, status: 'confirmed' } : x)));
      setStats((s) =>
        s
          ? { ...s, pendingOrders: Math.max(0, s.pendingOrders - 1), inProgress: s.inProgress + 1 }
          : s,
      );
      showToast('success', 'Đã xác nhận đơn');
    } catch (e) {
      showToast('error', apiError(e));
    } finally {
      setBusy('');
    }
  };
  const staleCount = offers.filter((offer) => offer.active && (offer.stale || offer.priceAgeHours >= 36)).length;
  const confirmAll = async () => {
    if (busy) return;
    setBusy('all');
    try {
      await agrilinkManageApi.confirmAllBuyOffers();
      setOffers(await agrilinkManageApi.buyOffers());
      showToast('success', 'Đã giữ giá hôm nay cho tất cả tin thu mua');
    } catch (e) {
      showToast('error', apiError(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <PageHeader
        title="Tổng quan AgriLink"
        actions={
          <select
            className="form-select"
            aria-label="Khoảng thời gian"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            <option value="7">7 ngày</option>
            <option value="30">30 ngày</option>
            <option value="month">Tháng này</option>
          </select>
        }
      />
      {error && <p className="text-danger">{error}</p>}
      {staleCount > 0 && <div className="agl-price-reminder card mb-3" role="status">
        <img src={iconAlarm} alt="" width="36" height="36" />
        <div className="flex-grow-1">
          <strong>{staleCount} tin thu mua cần cập nhật giá</strong>
          <span>Tin sắp hết hạn giá hoặc đã ẩn khỏi tìm kiếm. Giữ giá hôm nay để nông dân vẫn thấy tin.</span>
        </div>
        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void confirmAll()}>Giữ giá hôm nay cho tất cả</button>
      </div>}
      {!stats ? (
        <SkeletonState variant="cards" count={4} />
      ) : (
        <div className="row g-3 mb-4">
          <div className="col-6 col-xl-3">
            <Link to="/agrilink/quan-ly/don?status=pending" className="text-decoration-none text-reset d-block h-100">
              <OverviewStat label="Đơn chờ xác nhận" value={stats.pendingOrders} icon={iconPending} tone="amber" />
            </Link>
          </div>
          <div className="col-6 col-xl-3">
            <OverviewStat label="Đang xử lý" value={stats.inProgress} icon={iconProgress} tone="blue" />
          </div>
          <div className="col-6 col-xl-3">
            <OverviewStat
              label="Tỉ lệ chấp nhận"
              value={stats.acceptanceRate == null ? '—' : `${Math.round(stats.acceptanceRate * 100)}%`}
              icon={iconRate}
              tone="violet"
            />
          </div>
          {canSeeFinance && (
          <div className="col-6 col-xl-3">
            <OverviewStat
              label="Doanh số AgriLink"
              value={<MoneyText value={Math.round(stats.completedBuyRevenue)} />}
              icon={iconRevenue}
              tone="green"
              note={<>Thu mua {fmtKg(stats.completedSellKg)} / <MoneyText value={Math.round(stats.completedSellAmount)} /></>}
            />
          </div>
          )}
        </div>
      )}
      <div className="card">
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">Đơn mới nhất</h5>
            <Link to="/agrilink/quan-ly/don">Xem tất cả</Link>
          </div>
          {orders.length ? (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mã đơn</th>
                    <th>Người mua</th>
                    <th>Giá trị</th>
                    <th>Trạng thái</th>
                    <th>Thời gian</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link to={`/agrilink/quan-ly/don/${order.id}`}>{order.code}</Link>
                      </td>
                      <td>{order.contactName}</td>
                      <td>
                        <MoneyText value={Math.round(orderPayable(order))} />
                      </td>
                      <td>
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td>{fmtDateTime(order.createdAt)}</td>
                      <td>
                        {order.status === 'pending' && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={!!busy}
                            onClick={() => void confirm(order.id)}
                          >
                            Xác nhận
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Chưa có đơn hàng" />
          )}
        </div>
      </div>
    </>
  );
}
