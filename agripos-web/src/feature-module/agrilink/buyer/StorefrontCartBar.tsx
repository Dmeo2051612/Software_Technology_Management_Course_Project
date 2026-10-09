import { Link } from 'react-router-dom';
import { MoneyText } from '../../../components/ui';
import { useAgrilinkCart } from '../../../stores/agrilinkCartStore';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import { roundMatchingVND } from './matchingLogic';
import './storefrontCartBar.css';

/** Thanh giỏ hàng nổi ở trang đại lý: hiện khi giỏ của đại lý này có hàng. */
export default function StorefrontCartBar({ dealerId }: { dealerId: string }) {
  const lines = useAgrilinkCart((s) => s.carts[dealerId]?.lines) ?? [];
  if (!lines.length) return null;
  const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const first = lines[0];
  const more = lines.length - 1;
  return (
    <>
      {/* Chừa chỗ để thanh không che thẻ sản phẩm cuối trang. */}
      <div className="sf-cart-spacer" aria-hidden="true" />
      <div className="sf-cart-bar" role="region" aria-label="Giỏ hàng của đại lý này">
        <div className="sf-cart-thumbs" aria-hidden="true">
          {lines.slice(0, 3).map((line) =>
            line.imageUrl ? (
              <img key={line.offerId} src={normalizeImageUrl(line.imageUrl) || ''} alt="" />
            ) : (
              <span key={line.offerId}>
                <i className="ti ti-package" />
              </span>
            ),
          )}
          {lines.length > 3 && <span className="sf-cart-more">+{lines.length - 3}</span>}
        </div>
        <div className="sf-cart-info">
          <strong>
            {lines.length} sản phẩm trong giỏ
          </strong>
          <span>
            {first.name}
            {more > 0 && ` và ${more} sản phẩm khác`}
          </span>
        </div>
        <div className="sf-cart-total" key={total}>
          <small>Tạm tính</small>
          <MoneyText value={roundMatchingVND(total)} bold />
        </div>
        <Link to="/agrilink/gio-hang" className="btn btn-primary sf-cart-checkout">
          <i className="ti ti-shopping-cart me-1" aria-hidden="true" />
          Thanh toán
        </Link>
      </div>
    </>
  );
}
