import { beforeEach, describe, expect, it } from 'vitest';
import { stepDown, stepUp, useAgrilinkCart } from './agrilinkCartStore';

const dealer = { id: 'd1', name: 'Đại lý A' };
const line = {
  offerId: 'o1',
  name: 'Phân bón',
  unit: 'bao',
  price: 1200,
  imageUrl: null,
  quantity: 2,
};
beforeEach(() => {
  localStorage.clear();
  useAgrilinkCart.setState({ carts: {} });
});
describe('AgriLink cart', () => {
  it('sums repeated offers and persists', () => {
    useAgrilinkCart.getState().add(dealer, line);
    useAgrilinkCart.getState().add(dealer, { ...line, quantity: 3 });
    expect(useAgrilinkCart.getState().carts.d1.lines[0].quantity).toBe(5);
    expect(localStorage.getItem('agrilink_cart_v1')).toContain('o1');
  });
  it('keeps carts per dealer and rounds totals', () => {
    useAgrilinkCart.getState().add(dealer, { ...line, price: 10.3 });
    useAgrilinkCart.getState().add({ id: 'd2', name: 'B' }, line);
    expect(useAgrilinkCart.getState().total('d1')).toBe(21);
    expect(useAgrilinkCart.getState().total('d2')).toBe(2400);
    expect(useAgrilinkCart.getState().count()).toBe(4);
  });
  it('rounds each fractional line before summing', () => {
    useAgrilinkCart
      .getState()
      .add(dealer, { ...line, offerId: 'o1', price: 1001, quantity: 0.333 });
    useAgrilinkCart
      .getState()
      .add(dealer, { ...line, offerId: 'o2', price: 1001, quantity: 0.333 });
    expect(useAgrilinkCart.getState().total('d1')).toBe(666);
  });
  it('removes zero quantity and clears one dealer', () => {
    useAgrilinkCart.getState().add(dealer, line);
    useAgrilinkCart.getState().setQty('d1', 'o1', 0);
    expect(useAgrilinkCart.getState().carts.d1).toBeUndefined();
    useAgrilinkCart.getState().add(dealer, line);
    useAgrilinkCart.getState().clear('d1');
    expect(useAgrilinkCart.getState().carts.d1).toBeUndefined();
  });
});

describe('quantity stepper', () => {
  it('moves by whole units and rounds fractional quantities toward the step', () => {
    expect(stepUp(2)).toBe(3);
    expect(stepDown(2)).toBe(1);
    expect(stepDown(1)).toBe(0);
    expect(stepUp(1.5)).toBe(2);
    expect(stepDown(1.5)).toBe(1);
    expect(stepDown(0.5)).toBe(0);
  });
});
