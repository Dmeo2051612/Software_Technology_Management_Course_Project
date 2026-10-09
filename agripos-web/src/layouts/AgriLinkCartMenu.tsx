import { Link, useNavigate } from 'react-router-dom';
import { MoneyText } from '../components/ui';
import { stepDown, stepUp, useAgrilinkCart } from '../stores/agrilinkCartStore';
import { normalizeImageUrl } from '../utils/imageUrl';
import { useDropdown } from './useDropdown';

/**
 * Nút giỏ hàng dạng sổ xuống: xem nhanh theo từng đại lý, chỉnh số lượng,
 * xoá món; "Xem giỏ hàng & đặt hàng" mở trang giỏ đầy đủ.
 */
export default function AgriLinkCartMenu({ count }: { count: number }) {
  const navigate = useNavigate();
  const { open, setOpen, rootRef } = useDropdown();
  const carts = useAgrilinkCart((s) => s.carts);
  const setQty = useAgrilinkCart((s) => s.setQty);
  const remove = useAgrilinkCart((s) => s.remove);
  const total = useAgrilinkCart((s) => s.total);
  const list = Object.values(carts);
  const grand = list.reduce((sum, cart) => sum + total(cart.dealerId), 0);

  return (
    <div className="agrilink-notify" ref={rootRef}>
      <button
        type="button"
        className={`alh-circle${open ? ' is-open' : ''}`}
        aria-label={count ? `Giỏ hàng, ${count} sản phẩm` : 'Giỏ hàng'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
      >
        <i className="ti ti-shopping-cart" aria-hidden="true" />
        {count > 0 && <span className="alh-count">{count > 99 ? '99+' : count}</span>}
        {!open && (
          <span className="alh-tip" aria-hidden="true">
            Giỏ hàng
          </span>
        )}
      </button>

      {open && (
        <div className="agrilink-notify-panel alh-cart-panel" role="dialog" aria-label="Giỏ hàng">
          <div className="agrilink-notify-head">
            <strong>Giỏ hàng</strong>
            {list.length > 1 && <small className="text-muted">{list.length} đại lý · mỗi đại lý một đơn</small>}
          </div>
          <div className="agrilink-notify-list">
            {!list.length ? (
              <div className="agrilink-notify-empty">
                Giỏ hàng đang trống.{' '}
                <Link to="/agrilink" onClick={() => setOpen(false)}>
                  Khám phá đại lý
                </Link>
              </div>
            ) : (
              list.map((cart) => (
                <section key={cart.dealerId} className="alh-cart-group">
                  <div className="alh-cart-dealer">
                    <i className="ti ti-building-store" aria-hidden="true" />
                    <Link to={`/agrilink/dai-ly/${cart.dealerId}`} onClick={() => setOpen(false)}>
                      {cart.dealerName}
                    </Link>
                  </div>
                  {cart.lines.map((line) => (
                    <div key={line.offerId} className="alh-cart-line">
                      {line.imageUrl ? (
                        <img src={normalizeImageUrl(line.imageUrl) || ''} alt="" />
                      ) : (
                        <span className="alh-cart-thumb" aria-hidden="true">
                          <i className="ti ti-package" />
                        </span>
                      )}
                      <div className="alh-cart-info">
                        <span className="alh-cart-name">{line.name}</span>
                        <small>
                          <MoneyText value={Math.round(line.price)} />/{line.unit}
                        </small>
                        <div className="alh-stepper" role="group" aria-label={`Số lượng ${line.name}`}>
                          <button type="button" aria-label="Bớt 1" onClick={() => setQty(cart.dealerId, line.offerId, stepDown(line.quantity))}>
                            <i className="ti ti-minus" aria-hidden="true" />
                          </button>
                          <span>{line.quantity}</span>
                          <button type="button" aria-label="Thêm 1" onClick={() => setQty(cart.dealerId, line.offerId, stepUp(line.quantity))}>
                            <i className="ti ti-plus" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="alh-cart-right">
                        <strong>
                          <MoneyText value={Math.round(line.price * line.quantity)} />
                        </strong>
                        <button
                          type="button"
                          className="alh-cart-remove"
                          aria-label={`Xoá ${line.name}`}
                          onClick={() => remove(cart.dealerId, line.offerId)}
                        >
                          <i className="ti ti-trash" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
          {list.length > 0 && (
            <div className="alh-cart-foot">
              <span>
                Tạm tính <MoneyText value={Math.round(grand)} bold />
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setOpen(false);
                  navigate('/agrilink/gio-hang');
                }}
              >
                Xem giỏ hàng & đặt hàng
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
