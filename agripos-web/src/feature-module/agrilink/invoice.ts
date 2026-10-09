import type { InvoiceA5Data } from '../../components/receipt/InvoiceA5';
import type { OrderDetail } from '../../services/agrilink.types';

const PRINTABLE_STATUSES = ['confirmed', 'delivering', 'completed'];

/** Hoá đơn chỉ dành cho đơn mua vật tư đã được đại lý xác nhận. */
export function canPrintInvoice(order: Pick<OrderDetail, 'kind' | 'status'>): boolean {
  return order.kind === 'buy' && PRINTABLE_STATUSES.includes(order.status);
}

/** Chuyển đơn AgriLink sang dữ liệu hoá đơn A5 dùng chung với POS. */
export function agrilinkOrderToInvoice(order: OrderDetail): InvoiceA5Data {
  const items = order.items.map((item) => {
    const quantity = item.finalQuantity ?? item.quantity;
    const unitPrice = Math.round(item.finalUnitPrice ?? item.unitPrice);
    return {
      productName: item.unit ? `${item.itemName} (${item.unit})` : item.itemName,
      unitPrice,
      quantity,
      total: Math.round(quantity * unitPrice),
    };
  });
  const subtotal = items.reduce((sum, line) => sum + line.total, 0);
  const discount = Math.min(Math.round(order.discountAmount ?? 0), subtotal);
  const note = [
    `Đơn AgriLink ${order.code}`,
    discount > 0 && order.voucherTitle ? `Voucher: ${order.voucherTitle}` : '',
    order.note?.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    orderCode: order.code,
    createdAt: order.createdAt,
    customerName: order.contactName,
    customerPhone: order.contactPhone,
    customerAddress: order.address?.trim() || undefined,
    items,
    subtotal,
    discount,
    total: subtotal - discount,
    note,
  };
}
