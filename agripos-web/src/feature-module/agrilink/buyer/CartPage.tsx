import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, MoneyText, PageHeader } from '../../../components/ui';
import { roundMatchingVND } from './matchingLogic';
import { agrilinkBuyerApi, apiError } from '../../../services/agrilink.service';
import type { Fulfillment, Storefront } from '../../../services/agrilink.types';
import { useAgrilinkCart, type CartLine } from '../../../stores/agrilinkCartStore';
import { useAuthStore } from '../../../stores/authStore';
import { showToast } from '../../../stores/toastStore';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import { fulfillmentLabels } from '../labels';
import { validContactPhone, validQuantity } from '../validation';
import { bestVoucher, voucherBlocker, voucherDiscount } from '../voucher';
import VoucherPicker from './VoucherPicker';
import '../components/voucher.css';
import DeliveryAddressFields, { addressError, emptyAddress, formatAddress, type DeliveryAddress } from '../components/DeliveryAddressFields';

// Địa chỉ giao lần trước (tiện cho khách mua lại); trình duyệt chặn bộ nhớ thì bỏ qua.
const LAST_ADDRESS_KEY = 'agl-last-delivery-address';
function lastAddress(): DeliveryAddress {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_ADDRESS_KEY) || 'null');
    return saved && typeof saved.provinceCode === 'string' ? { ...emptyAddress, ...saved } : emptyAddress;
  } catch {
    return emptyAddress;
  }
}

type Checkout = {
  fulfillment: Fulfillment;
  delivery: DeliveryAddress;
  contactName: string;
  contactPhone: string;
  note: string;
};

function CartLineRow({
  line,
  onQty,
  onRemove,
  onError,
}: {
  line: CartLine;
  onQty: (qty: number) => void;
  onRemove: () => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState(String(line.quantity));
  const commit = () => {
    if (!text.trim()) {
      setText(String(line.quantity));
      return;
    }
    const qty = Number(text);
    if (qty === 0) {
      onRemove();
      return;
    }
    if (!validQuantity(qty)) {
      onError('Số lượng phải lớn hơn 0 và có tối đa 3 chữ số thập phân.');
      setText(String(line.quantity));
      return;
    }
    onError('');
    onQty(qty);
  };
  return (
    <div className="d-flex flex-wrap align-items-center gap-3 border-bottom py-3">
      {line.imageUrl && (
        <img
          src={normalizeImageUrl(line.imageUrl) || ''}
          alt=""
          width="56"
          height="56"
          className="rounded object-fit-cover"
        />
      )}
      {/* Tên chiếm tối thiểu 150px; màn hẹp thì ô số lượng và nút Xoá xuống dòng thay vì bóp tên. */}
      <div style={{ flex: '1 1 150px', minWidth: 0 }}>
        <strong>{line.name}</strong>
        <div className="text-muted">
                      <MoneyText value={roundMatchingVND(line.price)} />/{line.unit}
        </div>
      </div>
      <input
        className="form-control flex-shrink-0"
        style={{ width: 84 }}
        type="number"
        min="0"
        step="0.001"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        aria-label={`Số lượng ${line.name}`}
      />
      <button type="button" className="btn btn-outline-danger btn-sm" onClick={onRemove}>
        Xoá
      </button>
    </div>
  );
}

export default function CartPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const carts = useAgrilinkCart((s) => s.carts);
  const setQty = useAgrilinkCart((s) => s.setQty);
  const remove = useAgrilinkCart((s) => s.remove);
  const clear = useAgrilinkCart((s) => s.clear);
  const total = useAgrilinkCart((s) => s.total);
  const [storefronts, setStorefronts] = useState<Record<string, Storefront>>({});
  const [forms, setForms] = useState<Record<string, Checkout>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<Record<string, string>>({});
  // undefined = tự chọn voucher giảm nhiều nhất; null = khách chọn không dùng.
  const [voucherChoice, setVoucherChoice] = useState<Record<string, string | null>>({});
  const [picking, setPicking] = useState('');
  const ids = Object.keys(carts);

  useEffect(() => {
    let active = true;
    ids.forEach((id) => {
      if (storefronts[id]) return;
      agrilinkBuyerApi
        .storefront(id)
        .then((data) => {
          if (!active) return;
          setStorefronts((s) => ({ ...s, [id]: data }));
          setForms((s) => ({
            ...s,
            [id]: s[id] || {
              fulfillment: data.dealer.fulfillmentOptions[0] || 'pickup',
              delivery: lastAddress(),
              contactName: user?.fullName || '',
              contactPhone: user?.phone || '',
              note: '',
            },
          }));
        })
        .catch((e) => {
          if (active) setError((s) => ({ ...s, [id]: apiError(e) }));
        });
    });
    return () => {
      active = false;
    };
  }, [ids.join(','), user?.fullName, user?.phone]);

  const update = (id: string, patch: Partial<Checkout>) =>
    setForms((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const setErrorFor = (id: string, message: string) => setError((s) => ({ ...s, [id]: message }));
  /** Voucher đang áp cho giỏ của một đại lý (bỏ qua nếu không còn đủ điều kiện). */
  const voucherFor = (id: string) => {
    const vouchers = storefronts[id]?.vouchers;
    const subtotal = total(id);
    const choice = voucherChoice[id];
    if (choice === undefined) return bestVoucher(vouchers, subtotal);
    const picked = choice ? vouchers?.find((v) => v.id === choice) : undefined;
    return picked && !voucherBlocker(picked, subtotal) ? picked : null;
  };
  /** Tải lại gian hàng và cập nhật giá trong giỏ theo giá hiện tại (máy chủ tính theo giá này). */
  const refreshStore = (id: string) =>
    agrilinkBuyerApi
      .storefront(id)
      .then((data) => {
        setStorefronts((s) => ({ ...s, [id]: data }));
        useAgrilinkCart.setState((state) => {
          const current = state.carts[id];
          if (!current) return state;
          const lines = current.lines.map((line) => ({
            ...line,
            price: data.saleOffers.find((x) => x.offerId === line.offerId)?.price ?? line.price,
          }));
          return { carts: { ...state.carts, [id]: { ...current, lines } } };
        });
      })
      .catch(() => {});
  const place = async (id: string) => {
    const cart = carts[id],
      form = forms[id],
      storefront = storefronts[id];
    if (!cart || !form || !storefront) return;
    if (!form.contactName.trim()) {
      setErrorFor(id, 'Vui lòng nhập tên liên hệ.');
      return;
    }
    const delivering = form.fulfillment === 'delivery';
    if (delivering && addressError(form.delivery)) {
      setErrorFor(id, addressError(form.delivery));
      return;
    }
    if (!validContactPhone(form.contactPhone)) {
      setErrorFor(id, 'Số điện thoại phải có 8–15 ký tự số, dấu cách hoặc dấu chấm.');
      return;
    }
    if (cart.lines.some((line) => !validQuantity(line.quantity))) {
      setErrorFor(id, 'Số lượng phải lớn hơn 0 và có tối đa 3 chữ số thập phân.');
      return;
    }
    setBusy(id);
    setErrorFor(id, '');
    const voucher = voucherFor(id);
    try {
      const { delivery, ...rest } = form;
      const address = delivering ? await formatAddress(delivery) : '';
      const order = await agrilinkBuyerApi.placeOrder(id, {
        kind: 'buy',
        items: cart.lines.map((line) => ({ offerId: line.offerId, quantity: line.quantity })),
        ...rest,
        address,
        ...(voucher ? { voucherId: voucher.id } : {}),
      });
      if (delivering)
        try {
          localStorage.setItem(LAST_ADDRESS_KEY, JSON.stringify(delivery));
        } catch {
          /* bộ nhớ trình duyệt bị chặn — không sao */
        }
      clear(id);
      showToast('success', `Đã gửi đơn ${order.code}`);
      navigate(`/agrilink/don-cua-toi/${order.id}`);
    } catch (e) {
      const message = apiError(e);
      setErrorFor(id, message);
      if (voucher)
        // Voucher có thể vừa hết lượt/hết hạn hoặc giá đã đổi: để hệ thống chọn lại theo giá mới.
        setVoucherChoice((s) => {
          const next = { ...s };
          delete next[id];
          return next;
        });
      if (voucher || message.includes('không còn khả dụng')) void refreshStore(id);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHeader title="Giỏ hàng" subtitle="Mỗi đại lý sẽ nhận một đơn riêng" />
      {!ids.length ? (
        <EmptyState
          title="Giỏ hàng đang trống"
          action={
            <Link className="btn btn-primary" to="/agrilink">
              Khám phá đại lý
            </Link>
          }
        />
      ) : (
        <div className="d-grid gap-4">
          {ids.map((id) => {
            const cart = carts[id],
              form = forms[id],
              dealer = storefronts[id]?.dealer,
              vouchers = storefronts[id]?.vouchers ?? [],
              subtotal = total(id),
              voucher = voucherFor(id),
              discount = voucher ? voucherDiscount(voucher, subtotal) : 0;
            return (
              <section className="card" key={id}>
                <div className="card-body p-4">
                  <h4>{cart.dealerName}</h4>
                  {cart.lines.map((line) => (
                    <CartLineRow
                      key={`${line.offerId}:${line.quantity}`}
                      line={line}
                      onQty={(qty) => setQty(id, line.offerId, qty)}
                      onRemove={() => remove(id, line.offerId)}
                      onError={(message) => setErrorFor(id, message)}
                    />
                  ))}
                  {vouchers.length > 0 && (
                    <div className="cart-voucher-row">
                      <i className="ti ti-ticket" aria-hidden="true" />
                      <div className="flex-grow-1">
                        {voucher ? (
                          <>
                            <strong>{voucher.title}</strong>
                            <div className="small text-muted">
                              Giảm <MoneyText value={discount} />
                              {voucherChoice[id] === undefined ? ' · đã chọn voucher giảm nhiều nhất' : ''}
                            </div>
                          </>
                        ) : (
                          <>
                            <strong>Voucher của đại lý</strong>
                            <div className="small text-muted">{vouchers.length} voucher — chọn để được giảm giá</div>
                          </>
                        )}
                      </div>
                      <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setPicking(id)}>
                        {voucher ? 'Đổi voucher' : 'Chọn voucher'}
                        <i className="ti ti-chevron-right ms-1" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <dl className="cart-summary">
                    <div>
                      <dt>Tạm tính</dt>
                      <dd>
                        <MoneyText value={roundMatchingVND(subtotal)} />
                      </dd>
                    </div>
                    {discount > 0 && (
                      <div className="is-discount">
                        <dt>Voucher của đại lý</dt>
                        <dd>
                          −<MoneyText value={discount} />
                        </dd>
                      </div>
                    )}
                    <div className="is-total">
                      <dt>Tổng thanh toán</dt>
                      <dd>
                        <MoneyText value={roundMatchingVND(subtotal - discount)} bold />
                      </dd>
                    </div>
                  </dl>
                  {picking === id && (
                    <VoucherPicker
                      dealerName={cart.dealerName}
                      vouchers={vouchers}
                      subtotal={subtotal}
                      selectedId={voucher?.id ?? null}
                      onClose={() => setPicking('')}
                      onApply={(voucherId) => {
                        setVoucherChoice((s) => ({ ...s, [id]: voucherId }));
                        setPicking('');
                      }}
                    />
                  )}
                  {form && (
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">Hình thức nhận hàng</label>
                        <select
                          className="form-select"
                          value={form.fulfillment}
                          onChange={(e) =>
                            update(id, { fulfillment: e.target.value as Fulfillment })
                          }
                        >
                          {dealer?.fulfillmentOptions.map((x) => (
                            <option value={x} key={x}>
                              {fulfillmentLabels[x]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {form.fulfillment === 'delivery' && (
                        <div className="col-12">
                          <DeliveryAddressFields
                            idPrefix={`addr-${id}`}
                            value={form.delivery}
                            onChange={(delivery) => update(id, { delivery })}
                          />
                        </div>
                      )}
                      <div className="col-md-6">
                        <label className="form-label">Tên liên hệ</label>
                        <input
                          className="form-control"
                          value={form.contactName}
                          onChange={(e) => update(id, { contactName: e.target.value })}
                          required
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">Số điện thoại</label>
                        <input
                          className="form-control"
                          value={form.contactPhone}
                          onChange={(e) => update(id, { contactPhone: e.target.value })}
                          required
                        />
                      </div>
                      <div className="col-12">
                        <label className="form-label">Ghi chú</label>
                        <textarea
                          className="form-control"
                          value={form.note}
                          onChange={(e) => update(id, { note: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                  {error[id] && <p className="text-danger mt-3">{error[id]}</p>}
                  <div className="text-end mt-3">
                    <button
                      className="btn btn-primary"
                      disabled={!form || busy === id}
                      onClick={() => void place(id)}
                    >
                      Đặt hàng
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
