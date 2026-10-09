import { describe, expect, it } from 'vitest';
import type { OrderDetail, OrderItem } from '../../services/agrilink.types';
import { agrilinkOrderToInvoice, canPrintInvoice } from './invoice';

const item = (over: Partial<OrderItem>): OrderItem => ({
  id: 'i1',
  offerId: 'f1',
  productId: 'p1',
  commodityType: null,
  itemName: 'NPK 16-16-8',
  unit: 'bao',
  quantity: 2,
  unitPrice: 450000,
  finalQuantity: null,
  finalUnitPrice: null,
  ...over,
});

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: 'o1',
    code: 'AL-20260929-001',
    kind: 'buy',
    status: 'confirmed',
    fulfillment: 'delivery',
    contactName: 'Nguyễn Minh An',
    contactPhone: '0912345678',
    itemCount: 1,
    estimatedTotal: 900000,
    finalTotal: null,
    createdAt: '2026-09-29T02:00:00Z',
    address: 'Cư M’gar, Đắk Lắk',
    note: 'Giao buổi sáng',
    rejectReason: null,
    cancelReason: null,
    items: [item({})],
    events: [],
    posRef: null,
    ...over,
  }) as OrderDetail;

describe('canPrintInvoice', () => {
  it('allows supply (buy) orders once the dealer has confirmed them', () => {
    expect(canPrintInvoice(order({ status: 'confirmed' }))).toBe(true);
    expect(canPrintInvoice(order({ status: 'delivering' }))).toBe(true);
    expect(canPrintInvoice(order({ status: 'completed' }))).toBe(true);
  });

  it('refuses pending, rejected, cancelled and crop-selling orders', () => {
    expect(canPrintInvoice(order({ status: 'pending' }))).toBe(false);
    expect(canPrintInvoice(order({ status: 'rejected' }))).toBe(false);
    expect(canPrintInvoice(order({ status: 'cancelled' }))).toBe(false);
    expect(canPrintInvoice(order({ kind: 'sell' }))).toBe(false);
  });
});

describe('agrilinkOrderToInvoice', () => {
  it('maps the buyer, lines and totals', () => {
    expect(agrilinkOrderToInvoice(order())).toEqual({
      orderCode: 'AL-20260929-001',
      createdAt: '2026-09-29T02:00:00Z',
      customerName: 'Nguyễn Minh An',
      customerPhone: '0912345678',
      customerAddress: 'Cư M’gar, Đắk Lắk',
      items: [{ productName: 'NPK 16-16-8 (bao)', unitPrice: 450000, quantity: 2, total: 900000 }],
      subtotal: 900000,
      discount: 0,
      total: 900000,
      note: 'Đơn AgriLink AL-20260929-001 · Giao buổi sáng',
    });
  });

  it('uses the dealer-adjusted final quantities and prices', () => {
    const invoice = agrilinkOrderToInvoice(
      order({ items: [item({ finalQuantity: 3, finalUnitPrice: 440000 })], finalTotal: 1320000 }),
    );
    expect(invoice.items[0]).toEqual({ productName: 'NPK 16-16-8 (bao)', unitPrice: 440000, quantity: 3, total: 1320000 });
    expect(invoice.subtotal).toBe(1320000);
    expect(invoice.total).toBe(1320000);
  });

  it('prints the voucher discount and names it in the note', () => {
    const invoice = agrilinkOrderToInvoice(order({ discountAmount: 45000, voucherTitle: 'Giảm 5%' }));
    expect(invoice).toMatchObject({ subtotal: 900000, discount: 45000, total: 855000 });
    expect(invoice.note).toBe('Đơn AgriLink AL-20260929-001 · Voucher: Giảm 5% · Giao buổi sáng');
  });

  it('rounds money to whole đồng and omits an empty address', () => {
    const invoice = agrilinkOrderToInvoice(order({ address: '', note: '', items: [item({ quantity: 1.5, unitPrice: 333333.33 })] }));
    expect(invoice.items[0].total).toBe(500000);
    expect(invoice.customerAddress).toBeUndefined();
    expect(invoice.note).toBe('Đơn AgriLink AL-20260929-001');
  });
});
