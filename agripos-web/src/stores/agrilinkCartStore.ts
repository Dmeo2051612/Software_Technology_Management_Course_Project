import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CartLine = {
  offerId: string;
  name: string;
  unit: string;
  price: number;
  imageUrl: string | null;
  quantity: number;
};
export type DealerCart = { dealerId: string; dealerName: string; lines: CartLine[] };
type CartState = {
  carts: Record<string, DealerCart>;
  add: (dealer: { id: string; name: string }, line: CartLine) => void;
  setQty: (dealerId: string, offerId: string, qty: number) => void;
  remove: (dealerId: string, offerId: string) => void;
  clear: (dealerId: string) => void;
  count: () => number;
  total: (dealerId: string) => number;
};
const notify = () => window.dispatchEvent(new Event('agrilink-cart-change'));
const withoutEmpty = (carts: Record<string, DealerCart>) =>
  Object.fromEntries(Object.entries(carts).filter(([, cart]) => cart.lines.length));
export const useAgrilinkCart = create<CartState>()(
  persist(
    (set, get) => ({
      carts: {},
      add: (dealer, line) => {
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) return;
        set((state) => {
          const old = state.carts[dealer.id] || {
            dealerId: dealer.id,
            dealerName: dealer.name,
            lines: [],
          };
          const found = old.lines.find((x) => x.offerId === line.offerId);
          const lines = found
            ? old.lines.map((x) =>
                x.offerId === line.offerId ? { ...line, quantity: x.quantity + line.quantity } : x,
              )
            : [...old.lines, line];
          return {
            carts: { ...state.carts, [dealer.id]: { ...old, dealerName: dealer.name, lines } },
          };
        });
        notify();
      },
      setQty: (dealerId, offerId, qty) => {
        set((state) => {
          const cart = state.carts[dealerId];
          if (!cart) return state;
          const lines = cart.lines
            .filter((x) => x.offerId !== offerId || qty > 0)
            .map((x) => (x.offerId === offerId ? { ...x, quantity: qty } : x));
          return { carts: withoutEmpty({ ...state.carts, [dealerId]: { ...cart, lines } }) };
        });
        notify();
      },
      remove: (dealerId, offerId) => get().setQty(dealerId, offerId, 0),
      clear: (dealerId) => {
        set((state) => {
          const carts = { ...state.carts };
          delete carts[dealerId];
          return { carts };
        });
        notify();
      },
      count: () =>
        Object.values(get().carts).reduce(
          (n, cart) => n + cart.lines.reduce((a, line) => a + line.quantity, 0),
          0,
        ),
      total: (dealerId) =>
        (get().carts[dealerId]?.lines || []).reduce(
          (n, line) => n + Math.round(line.price * line.quantity),
          0,
        ),
    }),
    { name: 'agrilink_cart_v1', partialize: (state) => ({ carts: state.carts }) },
  ),
);

/** Nút bớt: bớt 1 đơn vị; số lẻ (0,5 bao) về phần nguyên liền dưới, không âm (0 = xoá). */
export const stepDown = (qty: number) => Math.max(0, Number.isInteger(qty) ? qty - 1 : Math.floor(qty));
/** Nút thêm: thêm 1 đơn vị; số lẻ lên phần nguyên liền trên. */
export const stepUp = (qty: number) => (Number.isInteger(qty) ? qty + 1 : Math.ceil(qty));
