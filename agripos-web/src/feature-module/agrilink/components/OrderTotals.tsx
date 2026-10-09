import { MoneyText } from '../../../components/ui';
import type { OrderSummary } from '../../../services/agrilink.types';
import { orderPayable } from '../voucher';

/** Nhãn dòng tổng theo loại đơn và phía đang xem. */
function totalLabel(order: OrderSummary, side: 'buyer' | 'dealer'): string {
  const settled = order.finalTotal != null;
  if (side === 'dealer') return settled || order.kind === 'sell' ? 'Tổng chốt' : 'Khách phải trả';
  return settled || order.kind === 'sell' ? 'Tổng' : 'Tổng thanh toán';
}

/** Khối tổng tiền của chi tiết đơn: tạm tính, voucher (nếu có), số phải trả. */
export default function OrderTotals({ order, side }: { order: OrderSummary; side: 'buyer' | 'dealer' }) {
  const discount = order.discountAmount ?? 0;
  // Đã chốt: tạm tính suy từ tổng chốt để ba dòng luôn cộng khớp.
  const subtotal = order.finalTotal != null ? order.finalTotal + discount : order.estimatedTotal;
  return (
    <div className="text-end">
      <small className="text-muted d-block">
        Tạm tính: <MoneyText value={Math.round(subtotal)} />
      </small>
      {discount > 0 && (
        <small className="text-accent d-block">
          <i className="ti ti-ticket me-1" aria-hidden="true" />
          Voucher {order.voucherTitle ? `"${order.voucherTitle}"` : ''}: −<MoneyText value={discount} />
        </small>
      )}
      <h5 className="mt-1">
        {totalLabel(order, side)}: <MoneyText value={Math.round(orderPayable(order))} bold />
      </h5>
    </div>
  );
}
