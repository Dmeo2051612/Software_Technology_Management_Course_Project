import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MoneyText, PageHeader, SkeletonState } from '../../../components/ui';
import { roundMatchingVND } from './matchingLogic';
import { agrilinkBuyerApi, apiError } from '../../../services/agrilink.service';
import type { OrderDetail } from '../../../services/agrilink.types';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime } from '../../../utils/formatters';
import { matchingApi } from '../../../services/agrilink-matching.service';
import OrderStatusBadge from '../components/OrderStatusBadge';
import OrderTimeline from '../components/OrderTimeline';
import { fulfillmentLabel, kindLabels } from '../labels';
import { agrilinkOrderToInvoice, canPrintInvoice } from '../invoice';
import { printInvoiceA5 } from '../../../components/receipt/InvoiceA5';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import logoAgripos from '../../../assets/img/logo-agripos-full.svg';
import { messagingApi } from '../../../services/agrilink-messaging.service';
import ComplaintDialog, { canComplain } from '../messaging/ComplaintDialog';
import OrderTotals from '../components/OrderTotals';
import CancelOrderDialog from './CancelOrderDialog';
import ReasonNote from '../components/ReasonNote';

export default function MyOrderDetailPage() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<Set<string>>(() => new Set());
  const [comment, setComment] = useState('');
  const [printing, setPrinting] = useState(false);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    agrilinkBuyerApi
      .myOrder(id)
      .then((data) => {
        if (active) setOrder(data);
      })
      .catch((e) => {
        if (active) setError(apiError(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const cancel = async (reason: string) => {
    if (!order) return;
    setBusy(true);
    setCancelError('');
    try {
      setOrder(await agrilinkBuyerApi.cancelMyOrder(id, reason || undefined));
      setCancelOpen(false);
      showToast('success', `Đã huỷ đơn ${order.code}. Đại lý đã được thông báo.`);
    } catch (e) {
      setCancelError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const rate = async () => {
    if (!order || !stars) return;
    setBusy(true);
    setError('');
    try {
      await matchingApi.rate(id, {
        stars,
        ...(order.kind === 'sell' ? { accurateWeight: tags.has('accurateWeight'), paidOnTime: tags.has('paidOnTime') } : { asDescribed: tags.has('asDescribed') }),
        onTime: tags.has('onTime'),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setOrder(await agrilinkBuyerApi.myOrder(id));
      showToast('success', 'Đã gửi đánh giá');
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  const printInvoice = async () => {
    if (!order || printing) return;
    setPrinting(true);
    try {
      // Bản của người mua: thông tin đại lý lấy từ gian hàng công khai.
      const dealer = order.dealer
        ? await agrilinkBuyerApi.storefront(order.dealer.id).then((s) => s.dealer).catch(() => null)
        : null;
      printInvoiceA5(agrilinkOrderToInvoice(order), {
        storeName: dealer?.name || order.dealer?.name,
        storeAddress: dealer?.address,
        storePhone: dealer?.phone,
        logoUrl: normalizeImageUrl(dealer?.logoUrl) || logoAgripos,
      });
    } finally {
      setPrinting(false);
    }
  };
  const openChat = async () => {
    if (!order) return;
    try {
      const { id: threadId } = await messagingApi.chatForOrder(order.id);
      navigate(`/agrilink/tin-nhan/${threadId}`);
    } catch (e) {
      showToast('error', apiError(e));
    }
  };
  if (!order)
    return error ? <p className="text-danger">{error}</p> : <SkeletonState variant="detail" />;
  return (
    <>
      {complaintOpen && <ComplaintDialog order={order} onClose={() => setComplaintOpen(false)} />}
      {cancelOpen && (
        <CancelOrderDialog
          code={order.code}
          busy={busy}
          error={cancelError}
          onClose={() => setCancelOpen(false)}
          onConfirm={(reason) => void cancel(reason)}
        />
      )}
      <PageHeader
        title={`Đơn ${order.code}`}
        subtitle={`${kindLabels[order.kind]} · ${fmtDateTime(order.createdAt)}`}
        actions={
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-primary" onClick={() => void openChat()}>
              <i className="ti ti-message-circle me-1" />
              Nhắn đại lý
            </button>
            {canComplain(order) && (
              <button type="button" className="btn btn-outline-danger" onClick={() => setComplaintOpen(true)}>
                <i className="ti ti-alert-triangle me-1" />
                Khiếu nại
              </button>
            )}
            {canPrintInvoice(order) && (
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={printing}
                onClick={() => void printInvoice()}
              >
                <i className="ti ti-printer me-1" />
                {printing ? 'Đang chuẩn bị…' : 'In hoá đơn'}
              </button>
            )}
            <Link to="/agrilink/don-cua-toi" className="btn btn-outline-primary">
              Đơn của tôi
            </Link>
          </div>
        }
      />
      <div className="d-flex gap-2 align-items-center mb-4">
        <OrderStatusBadge status={order.status} />
          <span>{fulfillmentLabel(order.kind, order.fulfillment)}</span>
      </div>
      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card mb-3">
            <div className="card-body p-4">
              <h5>Dòng hàng</h5>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Số lượng</th>
                      <th>Đơn giá</th>
                      <th>Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => {
                      const qty = item.finalQuantity ?? item.quantity,
                        price = item.finalUnitPrice ?? item.unitPrice;
                      return (
                        <tr key={item.id}>
                          <td>{item.itemName}</td>
                          <td>
                            {qty} {item.unit}
                            {item.finalQuantity != null && item.finalQuantity !== item.quantity && (
                              <del className="text-muted d-block">{item.quantity}</del>
                            )}
                          </td>
                          <td>
                            <MoneyText value={roundMatchingVND(price)} />
                            {item.finalUnitPrice != null &&
                              item.finalUnitPrice !== item.unitPrice && (
                                <del className="text-muted d-block">
                                  <MoneyText value={roundMatchingVND(item.unitPrice)} />
                                </del>
                              )}
                          </td>
                          <td>
                            <MoneyText value={roundMatchingVND(qty * price)} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <OrderTotals order={order} side="buyer" />
            </div>
          </div>
          <div className="card">
            <div className="card-body p-4">
              <h5>Lịch sử đơn</h5>
              <OrderTimeline events={order.events} />
            </div>
          </div>
          {order.status === 'completed' && <div className="card mt-3"><div className="card-body p-4"><h5>Đánh giá đại lý</h5>{order.rating ? <><p className="text-primary fs-4 mb-1">{[1,2,3,4,5].map(n => <i key={n} className={n <= order.rating!.stars ? 'ti ti-star-filled' : 'ti ti-star'} />)}</p><p className="text-muted">Đã gửi đánh giá {fmtDateTime(order.rating.createdAt)}</p>{order.rating.comment && <p>{order.rating.comment}</p>}</> : order.canRate ? <><p className="text-muted">Chọn số sao và điều đúng với giao dịch của bạn.</p><div className="d-flex gap-1 mb-3" role="group" aria-label="Chọn số sao">{[1,2,3,4,5].map(n => <button key={n} type="button" className={`btn ${n <= stars ? 'btn-primary' : 'btn-outline-primary'}`} aria-label={`${n} sao`} aria-pressed={n <= stars} onClick={() => setStars(n)}><i className="ti ti-star" /></button>)}</div><div className="d-flex flex-wrap gap-2 mb-3">{(order.kind === 'sell' ? [['accurateWeight','Cân đúng'],['paidOnTime','Trả tiền đúng hẹn'],['onTime','Đúng giờ hẹn']] : [['asDescribed','Đúng mô tả'],['onTime','Đúng giờ hẹn']]).map(([key,label]) => <button key={key} type="button" className={`btn btn-sm ${tags.has(key) ? 'btn-primary' : 'btn-outline-primary'}`} aria-pressed={!!tags.has(key)} onClick={() => setTags(v => { const next = new Set(v); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>{label}</button>)}</div><label className="form-label" htmlFor="rating-comment">Nhận xét thêm (không bắt buộc)</label><textarea id="rating-comment" className="form-control mb-3" maxLength={500} value={comment} onChange={e => setComment(e.target.value)} placeholder="Chia sẻ trải nghiệm của bạn…" /><div className="d-flex justify-content-between align-items-center gap-3"><small className="text-muted">Tên của bạn không hiển thị với người khác</small><button type="button" className="btn btn-primary" disabled={!stars || busy} onClick={() => void rate()}>Gửi đánh giá</button></div></> : <p className="text-muted mb-0">Thời hạn đánh giá đã kết thúc.</p>}</div></div>}
        </div>
        <div className="col-lg-4">
          <div className="card">
            <div className="card-body p-4">
              <h5>Thông tin nhận hàng</h5>
                <p>{fulfillmentLabel(order.kind, order.fulfillment)}</p>
              {order.address && <p>{order.address}</p>}
              <p>{order.dealer?.name || 'Đại lý'}</p>
              <p>
                {order.contactName} · <a href={`tel:${order.contactPhone}`}>{order.contactPhone}</a>
              </p>
              {order.note && <p>Ghi chú: {order.note}</p>}
              {order.rejectReason && (
                <ReasonNote kind="reject" text={order.rejectReason} />
              )}
              {order.cancelReason && (
                <ReasonNote kind="cancel" text={order.cancelReason} />
              )}
              {order.posRef && <p>Đã ghi nhận tại đại lý</p>}
              {['pending', 'confirmed'].includes(order.status) && (
                <button
                  className="btn btn-outline-danger"
                  disabled={busy}
                  onClick={() => {
                    setCancelError('');
                    setCancelOpen(true);
                  }}
                >
                  Huỷ đơn
                </button>
              )}
              {error && <p className="text-danger mt-2">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
