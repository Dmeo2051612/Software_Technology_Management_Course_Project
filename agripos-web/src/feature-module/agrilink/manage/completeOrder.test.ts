import { describe, expect, it } from 'vitest';
import type { MatchData, OrderDetail } from '../../../services/agrilink.types';
import {
  buildCompletePayload,
  canConfirmParty,
  completeDiscount,
  completeTotal,
  validateCompleteForm,
  type CompleteForm,
} from './completeOrder';

const order = { kind: 'buy', items: [{ id: 'i1', quantity: 2, unitPrice: 100000 }] } as OrderDetail;
const form: CompleteForm = {
  party: { mode: 'linked', id: 'p1' },
  lines: { i1: { quantity: 2, unitPrice: 100000 } },
  weights: [],
  pricePerKg: 0,
  weighDate: '2026-09-28',
  paymentMethod: 'cash',
  paidAmount: 0,
};
describe('canConfirmParty', () => {
  const matchData: MatchData = { linked: null, suggestions: [{ id: 'p1', name: 'A', phone: '0900000000' }] };
  it('blocks when nothing is chosen yet', () => {
    expect(canConfirmParty({ mode: 'none' }, null)).toBe(false);
    expect(canConfirmParty({ mode: 'none' }, matchData)).toBe(false);
  });
  it('requires match to have loaded before an existing linked/suggested party can be confirmed', () => {
    expect(canConfirmParty({ mode: 'suggestion', id: 'p1' }, null)).toBe(false);
    expect(canConfirmParty({ mode: 'linked', id: 'p1' }, null)).toBe(false);
    expect(canConfirmParty({ mode: 'suggestion', id: 'p1' }, matchData)).toBe(true);
  });
  it('allows creating a new party even when the /match lookup failed (match is null)', () => {
    expect(canConfirmParty({ mode: 'new' }, null)).toBe(true);
    expect(canConfirmParty({ mode: 'new' }, matchData)).toBe(true);
  });
});
describe('complete order payload', () => {
  it('rounds every buy line before summing', () => {
    const fractional = { ...order, items: [{ id: 'i1' }, { id: 'i2' }] } as OrderDetail;
    expect(
      completeTotal(fractional, {
        ...form,
        lines: {
          i1: { quantity: 0.333, unitPrice: 1001 },
          i2: { quantity: 0.333, unitPrice: 1001 },
        },
      }),
    ).toBe(666);
  });
  it.each([
    ['cash', 200000, 'cash'],
    ['transfer', 200000, 'transfer'],
    ['debt', 0, 'debt'],
    ['partial', 30000, 'cash'],
  ] as const)('maps %s payment', (paymentMethod, paidAmount, expectedMethod) => {
    expect(buildCompletePayload(order, { ...form, paymentMethod, paidAmount: 30000 })).toEqual({
      party: { customerId: 'p1' },
      items: [{ itemId: 'i1', quantity: 2, unitPrice: 100000 }],
      paymentMethod: expectedMethod,
      paidAmount,
    });
  });
  it('creates a new party when selected', () => {
    expect(buildCompletePayload(order, { ...form, party: { mode: 'new' } })).toMatchObject({
      party: { createNew: true },
    });
  });
  it('uses farmer and weights for sell orders', () => {
    const payload = buildCompletePayload(
      { ...order, kind: 'sell' },
      { ...form, weights: [12.5, 20], pricePerKg: 10000, paidAmount: 200000 },
    );
    expect(payload).toEqual({
      party: { farmerId: 'p1' },
      weights: [12.5, 20],
      pricePerKg: 10000,
      paidAmount: 200000,
      weighDate: '2026-09-28',
    });
  });
  it('validates party, quantities, partial payment and weights', () => {
    expect(validateCompleteForm(order, { ...form, party: { mode: 'suggestion' } })).toMatch(
      /khách hàng/i,
    );
    expect(
      validateCompleteForm(order, { ...form, lines: { i1: { quantity: 0, unitPrice: 100000 } } }),
    ).toMatch(/số lượng/i);
    expect(
      validateCompleteForm(order, { ...form, paymentMethod: 'partial', paidAmount: 0 }),
    ).toMatch(/trả một phần/i);
    expect(
      validateCompleteForm(order, { ...form, paymentMethod: 'partial', paidAmount: 200000 }),
    ).toMatch(/trả một phần/i);
    expect(validateCompleteForm({ ...order, kind: 'sell' }, form)).toMatch(/lần cân/i);
    expect(
      validateCompleteForm(
        { ...order, kind: 'sell' },
        { ...form, weights: [10], pricePerKg: 10000, paidAmount: 200000 },
      ),
    ).toMatch(/vượt/i);
  });
});
describe('completing a voucher order', () => {
  const voucherOrder = {
    ...order,
    voucherRule: { type: 'percent', value: 5, maxDiscount: 50000 },
  } as OrderDetail;
  it('recomputes the discount on the final lines', () => {
    expect(completeDiscount(voucherOrder, form)).toBe(10000);
    expect(completeDiscount(voucherOrder, { ...form, lines: { i1: { quantity: 20, unitPrice: 100000 } } })).toBe(50000);
    expect(completeDiscount(order, form)).toBe(0);
  });
  it('charges the total minus the voucher when paid in full', () => {
    expect(buildCompletePayload(voucherOrder, form)).toMatchObject({ paidAmount: 190000 });
    expect(validateCompleteForm(voucherOrder, { ...form, paymentMethod: 'partial', paidAmount: 190000 })).toBe(
      'Trả một phần phải lớn hơn 0 và nhỏ hơn tổng tiền.',
    );
    expect(validateCompleteForm(voucherOrder, { ...form, paymentMethod: 'partial', paidAmount: 150000 })).toBeNull();
  });
});
