import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal } from 'react-bootstrap';
import { MoneyText, PageHeader, SkeletonState } from '../../../components/ui';
import { all_routes } from '../../../routes/all_routes';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { OrderDetail, OrderItem } from '../../../services/agrilink.types';
import { useAuthStore } from '../../../stores/authStore';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime } from '../../../utils/formatters';
import { openAppTab } from '../../../utils/openAppTab';
import ReasonNote from '../components/ReasonNote';
import OrderStatusBadge from '../components/OrderStatusBadge';
import OrderTimeline from '../components/OrderTimeline';
import { fulfillmentLabel, kindLabels } from '../labels';
import CompleteOrderModal from './CompleteOrderModal';
import { printInvoiceA5 } from '../../../components/receipt/InvoiceA5';
import { getStoreSettings, type StoreSettingsData } from '../../../services/store-settings.service';
import { getInvoiceSettings, type InvoiceSettingsData } from '../../../services/invoice-settings.service';
import logoAgripos from '../../../assets/img/logo-agripos-full.svg';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import { agrilinkOrderToInvoice, canPrintInvoice } from '../invoice';
import { messagingApi } from '../../../services/agrilink-messaging.service';
import OrderTotals from '../components/OrderTotals';

/** API cài đặt có thể trả `{ data }` hoặc đối tượng trực tiếp. */
const unwrapSettings = <T,>(payload: unknown): T | null =>
  ((payload as { data?: T })?.data ?? (payload as T)) || null;

type Lines = Record<string, { quantity: number; unitPrice: number }>;
const posStatusLabels: Record<string, string> = {
  cancelled: 'Đã huỷ',
  completed: 'Hoàn thành',
  pending: 'Đang xử lý',
};

function OrderItemRow({
  item,
  line,
  editable,
  onChange,
}: {
  item: OrderItem;
  line: Lines[string] | undefined;
  editable: boolean;
  onChange: (line: Lines[string]) => void;
}) {
  const quantity = line?.quantity ?? item.quantity;
  const unitPrice = line?.unitPrice ?? item.unitPrice;
  return (
    <tr>
      <td>{item.itemName}</td>
      <td>
        {editable ? (
          <input
            className="form-control"
            type="number"
            min="0.001"
            step="0.001"
            value={line?.quantity ?? ''}
            onChange={(e) => onChange({ quantity: Number(e.target.value), unitPrice })}
            aria-label={`Số lượng ${item.itemName}`}
          />
        ) : (
          `${item.finalQuantity ?? item.quantity} ${item.unit}`
        )}
      </td>
      <td>
        {editable ? (
          <input
            className="form-control"
            type="number"
            min="0"
            step="0.01"
            value={line?.unitPrice ?? ''}
            onChange={(e) => onChange({ quantity, unitPrice: Number(e.target.value) })}
            aria-label={`Đơn giá ${item.itemName}`}
          />
        ) : (
          <MoneyText value={item.finalUnitPrice ?? item.unitPrice} />
        )}
      </td>
      <td>
        <MoneyText value={quantity * unitPrice} />
      </td>
    </tr>
  );
}

function OrderBody({
  order,
  lines,
  editable,
  busy,
  onLineChange,
  saveItems,
}: {
  order: OrderDetail;
  lines: Lines;
  editable: boolean;
  busy: boolean;
  onLineChange: (id: string, line: Lines[string]) => void;
  saveItems: () => void;
}) {
  return (
    <>
      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card mb-3">
            <div className="card-body p-4">
              <h5>Dòng hàng</h5>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Mặt hàng</th>
                      <th>Số lượng</th>
                      <th>Đơn giá</th>
                      <th>Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <OrderItemRow
                        key={item.id}
                        item={item}
                        line={lines[item.id]}
                        editable={editable}
                        onChange={(line) => onLineChange(item.id, line)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {editable && (
                <button className="btn btn-outline-primary" disabled={busy} onClick={saveItems}>
                  Lưu thay đổi
                </button>
              )}
              <OrderTotals order={order} side="dealer" />
            </div>
          </div>
          <div className="card">
            <div className="card-body p-4">
              <h5>Lịch sử đơn</h5>
              <OrderTimeline events={order.events} />
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card">
            <div className="card-body p-4">
              <h5>Người mua</h5>
              <p className="mb-1">{order.contactName}</p>
              <p>
                <a href={`tel:${order.contactPhone}`}>{order.contactPhone}</a>
              </p>
              {order.address && <p>{order.address}</p>}
              {order.note && <p>Ghi chú: {order.note}</p>}
              {order.rejectReason && (
                <ReasonNote kind="reject" text={order.rejectReason} />
              )}
              {order.cancelReason && (
                <ReasonNote kind="cancel" text={order.cancelReason} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function OrderActionBar({
  order,
  manager,
  busy,
  canComplete,
  id,
  run,
  onReason,
  onComplete,
  openDocument,
  onPrint,
  printing,
}: {
  order: OrderDetail;
  manager: boolean;
  busy: boolean;
  canComplete: boolean;
  id: string;
  run: (action: () => Promise<OrderDetail>, success: string) => Promise<void>;
  onReason: (action: 'reject' | 'cancel') => void;
  onComplete: () => void;
  openDocument: () => void;
  onPrint: () => void;
  printing: boolean;
}) {
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mt-4">
        {canPrintInvoice(order) && (
          <button className="btn btn-outline-secondary" disabled={printing} onClick={onPrint}>
            <i className="ti ti-printer me-1" />
            {printing ? 'Đang chuẩn bị…' : 'In hoá đơn'}
          </button>
        )}
        {manager && order.status === 'pending' && (
          <>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void run(() => agrilinkManageApi.confirm(id), 'Đã xác nhận đơn')}
            >
              Xác nhận
            </button>
            <button
              className="btn btn-outline-danger"
              disabled={busy}
              onClick={() => {
                onReason('reject');
              }}
            >
              Từ chối
            </button>
          </>
        )}
        {manager && order.status === 'confirmed' && order.fulfillment === 'delivery' && (
          <button
            className="btn btn-outline-primary"
            disabled={busy}
            onClick={() => void run(() => agrilinkManageApi.deliver(id), 'Đã bắt đầu giao')}
          >
            Bắt đầu giao
          </button>
        )}
        {canComplete && (
          <button className="btn btn-primary" onClick={() => onComplete()}>
            Hoàn thành
          </button>
        )}
        {manager && ['confirmed', 'delivering'].includes(order.status) && (
          <button
            className="btn btn-outline-danger"
            onClick={() => {
              onReason('cancel');
            }}
          >
            Huỷ đơn
          </button>
        )}
        {order.status === 'completed' && order.posRef && (
          <>
            <p className="mb-0">
              Chứng từ AgriPOS: {order.posRef.code} · Trạng thái:{' '}
              {posStatusLabels[order.posRef.status] || order.posRef.status}
            </p>
            <button className="btn btn-outline-primary" onClick={openDocument}>
              Mở chứng từ AgriPOS {order.posRef.code}
            </button>
          </>
        )}
      </div>
    </>
  );
}

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const role = useAuthStore((s) => s.user?.role);
  const manager = role === 'owner' || role === 'manager';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [lines, setLines] = useState<Lines>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [printing, setPrinting] = useState(false);
  const navigate = useNavigate();

  const printInvoice = async () => {
    if (!order || printing) return;
    setPrinting(true);
    try {
      // Đơn AgriLink in theo hồ sơ gian hàng (điều người mua nhìn thấy);
      // tài khoản ngân hàng và mẫu hoá đơn lấy từ cài đặt AgriPOS.
      const [profile, store, invoice] = await Promise.all([
        agrilinkManageApi.profile().catch(() => null),
        getStoreSettings().then((r) => unwrapSettings<StoreSettingsData>(r.data)).catch(() => null),
        getInvoiceSettings().then((r) => unwrapSettings<InvoiceSettingsData>(r.data)).catch(() => null),
      ]);
      printInvoiceA5(
        agrilinkOrderToInvoice(order),
        {
          storeName: profile?.name || store?.storeName,
          storeAddress: profile?.address || store?.address,
          storePhone: profile?.phone || store?.phone,
          logoUrl: normalizeImageUrl(profile?.logoUrl) || invoice?.logoUrl || logoAgripos,
          bankAccount: store?.bankAccount,
          bankName: store?.bankName,
        },
        invoice || undefined,
      );
    } finally {
      setPrinting(false);
    }
  };

  const load = useCallback(() => {
    agrilinkManageApi
      .order(id)
      .then((data) => {
        setOrder(data);
        setLines(
          Object.fromEntries(
            data.items.map((item) => [
              item.id,
              {
                quantity: item.finalQuantity ?? item.quantity,
                unitPrice: item.finalUnitPrice ?? item.unitPrice,
              },
            ]),
          ),
        );
        setError('');
      })
      .catch((e) => setError(apiError(e)));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<OrderDetail>, success: string) => {
    setBusy(true);
    setError('');
    try {
      setOrder(await action());
      showToast('success', success);
      setReasonAction(null);
    } catch (e) {
      const message = apiError(e);
      showToast('error', message);
      setError(message);
      if ((e as { response?: { status?: number } })?.response?.status === 409) load();
    } finally {
      setBusy(false);
    }
  };
  const saveItems = () => {
    if (!order) return;
    void run(
      () =>
        agrilinkManageApi.updateItems(
          id,
          order.items.map((item) => ({
            itemId: item.id,
            ...lines[item.id],
          })),
        ),
      'Đã lưu dòng hàng',
    );
  };
  const submitReason = () => {
    if (reason.trim().length < 3) {
      setError('Lý do phải có ít nhất 3 ký tự.');
      return;
    }
    void run(
      () =>
        reasonAction === 'reject'
          ? agrilinkManageApi.reject(id, reason.trim())
          : agrilinkManageApi.cancel(id, reason.trim()),
      reasonAction === 'reject' ? 'Đã từ chối đơn' : 'Đã huỷ đơn',
    );
  };
  if (!order)
    return error ? <p className="text-danger">{error}</p> : <SkeletonState variant="detail" />;

  const editable = manager && ['pending', 'confirmed'].includes(order.status);
  const canComplete =
    ['confirmed', 'delivering'].includes(order.status) &&
    (manager ||
      (role === 'cashier' && order.fulfillment !== 'delivery' && order.status === 'confirmed'));
  const openChat = async () => {
    try {
      const { id: threadId } = await messagingApi.chatForOrder(order.id);
      navigate(`/agrilink/quan-ly/tin-nhan/${threadId}`);
    } catch (e) {
      showToast('error', apiError(e));
    }
  };
  const openDocument = () => {
    if (!order.posRef) return;
    const route = order.posRef.type === 'order' ? all_routes.saleslist : all_routes.weighingSlips;
    openAppTab(`${route}?search=${encodeURIComponent(order.posRef.code)}`, 'agripos-main');
  };

  return (
    <>
      <PageHeader
        title={`Đơn ${order.code}`}
        subtitle={`${kindLabels[order.kind]} · ${fmtDateTime(order.createdAt)}`}
        actions={
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-primary" onClick={() => void openChat()}>
              <i className="ti ti-message-circle me-1" />
              Nhắn khách
            </button>
            <Link className="btn btn-outline-primary" to="/agrilink/quan-ly/don">
              Danh sách đơn
            </Link>
          </div>
        }
      />
      <div className="d-flex flex-wrap gap-2 align-items-center mb-4">
        <OrderStatusBadge status={order.status} />
          <span>{fulfillmentLabel(order.kind, order.fulfillment)}</span>
      </div>
      <OrderBody
        order={order}
        lines={lines}
        editable={editable}
        busy={busy}
        onLineChange={(itemId, line) => setLines((s) => ({ ...s, [itemId]: line }))}
        saveItems={saveItems}
      />
      <OrderActionBar
        order={order}
        manager={manager}
        busy={busy}
        canComplete={canComplete}
        id={id}
        run={run}
        onReason={(action) => {
          setReason('');
          setReasonAction(action);
        }}
        onComplete={() => setCompleteOpen(true)}
        openDocument={openDocument}
        onPrint={() => void printInvoice()}
        printing={printing}
      />
      {error && <p className="text-danger mt-3">{error}</p>}
      {completeOpen && (
        <CompleteOrderModal
          order={order}
          onClose={() => setCompleteOpen(false)}
          onConflict={(message) => {
            setCompleteOpen(false);
            showToast('error', message);
            load();
          }}
          onDone={(updated) => {
            setOrder(updated);
            setCompleteOpen(false);
            showToast('success', 'Đã hoàn thành đơn');
          }}
        />
      )}
      <Modal show={!!reasonAction} onHide={() => setReasonAction(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{reasonAction === 'reject' ? 'Từ chối đơn' : 'Huỷ đơn'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <label className="form-label">Lý do (ít nhất 3 ký tự)</label>
          <textarea
            className="form-control"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <p className="text-danger mt-2">{error}</p>}
        </Modal.Body>
        <Modal.Footer>
          <button className="btn btn-outline-secondary" onClick={() => setReasonAction(null)}>
            Đóng
          </button>
          <button
            className="btn btn-danger"
            disabled={busy || reason.trim().length < 3}
            onClick={submitReason}
          >
            Xác nhận
          </button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
