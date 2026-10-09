import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal } from 'react-bootstrap';
import { EmptyState, MoneyText, PageHeader, SkeletonState } from '../../../components/ui';
import { roundMatchingVND } from './matchingLogic';
import { agrilinkBuyerApi, apiError } from '../../../services/agrilink.service';
import type { BuyOfferPublic, SaleOffer, Storefront } from '../../../services/agrilink.types';
import { useAgrilinkCart } from '../../../stores/agrilinkCartStore';
import { useAuthStore } from '../../../stores/authStore';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime } from '../../../utils/formatters';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import { useSlidingPill } from '../../../utils/motion';
import { commodityLabels, fulfillmentLabels } from '../labels';
import { validContactPhone, validQuantity } from '../validation';
import { discountPercent, saleEndLabel } from '../listing';
import { messagingApi } from '../../../services/agrilink-messaging.service';
import VoucherStrip from './VoucherStrip';
import StorefrontCartBar from './StorefrontCartBar';
import { DealerCover } from '../components/DealerCover';
import { cropImage } from '../../../assets/img/crops';
import './storefront.css';
import VerifiedBadge from '../../../components/brand/VerifiedBadge';

function SaleOfferCard({
  offer,
  own,
  dealer,
  add,
}: {
  offer: SaleOffer;
  own: boolean;
  dealer: Storefront['dealer'];
  add: ReturnType<typeof useAgrilinkCart.getState>['add'];
}) {
  const [quantity, setQuantity] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [photo, setPhoto] = useState(0);
  const gallery = offer.images?.length ? offer.images : offer.imageUrl ? [offer.imageUrl] : [];
  const onSale = offer.originalPrice != null && offer.originalPrice > offer.price;
  const priceBlock = (
    <p className="storefront-price">
      <MoneyText value={roundMatchingVND(offer.price)} bold />/{offer.unit}
      {onSale && (
        <>
          <del>
            <MoneyText value={roundMatchingVND(offer.originalPrice!)} />
          </del>
          <span className="badge bg-danger">-{discountPercent(offer.originalPrice!, offer.price)}%</span>
          {offer.saleEndsAt && <small>{saleEndLabel(offer.saleEndsAt)}</small>}
        </>
      )}
    </p>
  );
  const addToCart = () => {
    if (!validQuantity(quantity)) {
      showToast('error', 'Số lượng phải lớn hơn 0 và có tối đa 3 chữ số thập phân.');
      return;
    }
    add(
      { id: dealer.id, name: dealer.name },
      {
        offerId: offer.offerId,
        name: offer.name,
        unit: offer.unit,
        price: offer.price,
        imageUrl: offer.imageUrl,
        quantity,
      },
    );
    showToast('success', 'Đã thêm vào giỏ hàng');
  };
  return (
    <div className="col-12 col-sm-6 col-xl-4">
      <div className="card h-100">
        <div className="card-body p-3 d-flex flex-column">
          <button
            type="button"
            className="storefront-product-open"
            onClick={() => {
              setPhoto(0);
              setDetailOpen(true);
            }}
            aria-label={`Xem chi tiết ${offer.name}`}
          >
            <span className="storefront-cover">
              {gallery[0] ? (
                <img src={normalizeImageUrl(gallery[0]) || ''} alt="" />
              ) : (
                <span className="storefront-cover-empty">
                  <i className="ti ti-package" aria-hidden="true" />
                </span>
              )}
              {onSale && <span className="badge bg-accent">Khuyến mãi</span>}
            </span>
            <h5>{offer.name}</h5>
          </button>
          {priceBlock}
          {offer.description && <p className="storefront-desc">{offer.description}</p>}
          {!offer.inStock && <span className="badge bg-light text-dark border mb-2">Hết hàng</span>}
          {!own && (
            <div className="d-flex gap-2 mt-auto pt-2">
              <input
                className="form-control"
                type="number"
                min="0.001"
                step="0.001"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                aria-label={`Số lượng ${offer.name}`}
              />
              <button
                className="btn btn-primary text-nowrap"
                disabled={!offer.inStock}
                onClick={addToCart}
              >
                Thêm vào giỏ
              </button>
            </div>
          )}
        </div>
      </div>
      <Modal show={detailOpen} onHide={() => setDetailOpen(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>{offer.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="storefront-detail">
            {gallery.length > 0 && (
              <div>
                <img className="storefront-detail-main" src={normalizeImageUrl(gallery[photo]) || ''} alt={offer.name} />
                {gallery.length > 1 && (
                  <div className="storefront-thumbs">
                    {gallery.map((url, index) => (
                      <button
                        key={url}
                        type="button"
                        className={index === photo ? 'active' : ''}
                        aria-label={`Ảnh ${index + 1}`}
                        onClick={() => setPhoto(index)}
                      >
                        <img src={normalizeImageUrl(url) || ''} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div>
              {priceBlock}
              <p className="text-muted mb-2">Quy cách: {offer.unit}</p>
              {!offer.inStock && <span className="badge bg-light text-dark border mb-2">Hết hàng</span>}
              <p className="storefront-detail-desc">{offer.description || 'Đại lý chưa thêm mô tả.'}</p>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </div>
  );
}

function BuyOfferCard({
  offer,
  own,
  onSell,
}: {
  offer: BuyOfferPublic;
  own: boolean;
  onSell: () => void;
}) {
  const photo = cropImage(offer.cropCode);
  return (
    <div className="card">
      <div className="card-body p-3 d-flex align-items-center flex-wrap gap-3">
        <span className="storefront-buy-photo">
          {photo ? <img src={photo} alt="" loading="lazy" /> : <i className="ti ti-plant-2" aria-hidden="true" />}
        </span>
        <div className="flex-grow-1">
          <h5>{offer.title}</h5>
          <p className="mb-1">
            <span className="storefront-buy-crop">
              {offer.cropName || (offer.commodityType ? commodityLabels[offer.commodityType] : 'Nông sản')}
            </span>{' '}
            <MoneyText value={roundMatchingVND(offer.price)} bold />/{offer.unit}
          </p>
          <small className="text-muted">Cập nhật {fmtDateTime(offer.updatedAt)}</small>
        </div>
        {!own && (
          <button className="btn btn-primary" onClick={onSell}>
            Bán cho đại lý
          </button>
        )}
      </div>
    </div>
  );
}

export default function StorefrontPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const add = useAgrilinkCart((s) => s.add);
  const [data, setData] = useState<Storefront | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'sale' | 'buy'>('sale');
  // Gạch chân trượt giữa hai tab (mockup 53 · M6); tab chỉ hiện sau khi tải xong nên khoá gồm cả `data`.
  const { barRef: tabsBarRef, pillRef: tabsPillRef } = useSlidingPill<HTMLUListElement, HTMLLIElement>(`${tab}-${data ? 1 : 0}`, '.nav-link.active');
  const [sell, setSell] = useState<BuyOfferPublic | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [contactName, setContactName] = useState(user?.fullName || '');
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    agrilinkBuyerApi
      .storefront(id)
      .then((x) => {
        if (active) setData(x);
      })
      .catch((e) => {
        if (active) setError(apiError(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  const own = !!user?.organizationId && user.organizationId === data?.dealer.id;
  const [opening, setOpening] = useState(false);
  const openChat = async () => {
    if (!data || opening) return;
    setOpening(true);
    try {
      const thread = await messagingApi.openChat(data.dealer.id);
      navigate(`/agrilink/tin-nhan/${thread.id}`);
    } catch (e) {
      showToast('error', apiError(e));
    } finally {
      setOpening(false);
    }
  };
  const placeSell = async () => {
    if (!sell || !data) return;
    if (!validQuantity(quantity) || !contactName.trim() || !validContactPhone(contactPhone)) {
      setError('Vui lòng nhập số lượng tối đa 3 chữ số thập phân, tên và số điện thoại hợp lệ.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const order = await agrilinkBuyerApi.placeOrder(data.dealer.id, {
        kind: 'sell',
        fulfillment: 'at_dealer',
        items: [{ offerId: sell.offerId, quantity }],
        contactName,
        contactPhone,
        note,
      });
      showToast('success', `Đã gửi đơn ${order.code}`);
      navigate(`/agrilink/don-cua-toi/${order.id}`);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return error ? <p className="text-danger">{error}</p> : <SkeletonState variant="detail" />;
  const { dealer } = data;

  // Vào từ trong app (danh sách, cộng đồng, tin nhắn…) thì quay lại đúng trang trước; mở thẳng link thì về Khám phá đại lý.
  const goBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate('/agrilink');
  };

  return (
    <>
      <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={goBack}>
        <i className="ti ti-arrow-left me-1" aria-hidden="true" />
        Quay lại
      </button>
      <PageHeader
        title={
          <>
            {dealer.name}
            {dealer.verified && <VerifiedBadge size={20} />}
          </>
        }
        actions={
          <div className="d-flex gap-2">
            {!own && (
              <button type="button" className="btn btn-primary" disabled={opening} onClick={() => void openChat()}>
                <i className="ti ti-message-circle me-1" />
                Nhắn đại lý
              </button>
            )}
            <Link className="btn btn-outline-primary" to="/agrilink/gio-hang">
              Xem giỏ hàng
            </Link>
          </div>
        }
      />
      <div className="card mb-4 p-0 overflow-hidden">
        <DealerCover coverUrl={dealer.coverUrl} logoUrl={dealer.logoUrl} variant="hero" />
        <div className="card-body px-4 pb-4 pt-3">
          <div>
            <p className="storefront-bio">{dealer.bio}</p>
            <p className="mb-1">
              <i className="ti ti-map-pin me-1 text-muted" aria-hidden="true" />
              {dealer.address} · <a href={`tel:${dealer.phone}`}>{dealer.phone}</a>
            </p>
            {dealer.openingHours && (
              <small className="text-muted">
                <i className="ti ti-clock me-1" aria-hidden="true" />
                {dealer.openingHours}
              </small>
            )}
          </div>
          <div className="d-flex gap-2 mt-3 flex-wrap">
            {dealer.fulfillmentOptions?.map((option) => (
              <span key={option} className="badge bg-light text-dark border">
                {fulfillmentLabels[option]}
              </span>
            ))}
          </div>
        </div>
      </div>
      {!!data.vouchers?.length && (
        <VoucherStrip
          vouchers={data.vouchers}
          canSave={!own}
          onSaved={(voucherId) =>
            setData((s) =>
              s && { ...s, vouchers: s.vouchers?.map((v) => (v.id === voucherId ? { ...v, saved: true } : v)) },
            )
          }
        />
      )}
      <ul className="nav nav-tabs mb-3 agl-underline has-pill" ref={tabsBarRef}>
        <li ref={tabsPillRef} className="agri-tab-pill" aria-hidden="true" />
        <li className="nav-item">
          <button
            className={`nav-link${tab === 'sale' ? ' active' : ''}`}
            onClick={() => setTab('sale')}
          >
            Vật tư
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link${tab === 'buy' ? ' active' : ''}`}
            onClick={() => setTab('buy')}
          >
            Thu mua nông sản
          </button>
        </li>
      </ul>
      <div key={tab} className="agl-tab-panel">
      {tab === 'sale' ? (
        data.saleOffers.length ? (
          <div className="row g-3">
            {data.saleOffers.map((offer) => (
              <SaleOfferCard
                key={offer.offerId}
                offer={offer}
                own={own}
                dealer={dealer}
                add={add}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Chưa có vật tư đăng bán" />
        )
      ) : data.buyOffers.length ? (
        <div className="d-grid gap-3">
          {data.buyOffers.map((offer) => (
            <BuyOfferCard
              key={offer.offerId}
              offer={offer}
              own={own}
              onSell={() => {
                setSell(offer);
                setQuantity(1);
                setError('');
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="Chưa có tin thu mua" />
      )}
      </div>
      <Modal show={!!sell} onHide={() => setSell(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Bán cho đại lý</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{sell?.title}</p>
          <label className="form-label">Số lượng dự kiến (kg)</label>
          <input
            className="form-control mb-3"
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
          {!validQuantity(quantity) && (
            <small className="text-danger d-block mb-2">
              Số lượng phải lớn hơn 0 và có tối đa 3 chữ số thập phân.
            </small>
          )}
          <label className="form-label">Tên liên hệ</label>
          <input
            className="form-control mb-3"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
          <label className="form-label">Số điện thoại</label>
          <input
            className="form-control mb-3"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          {!!contactPhone && !validContactPhone(contactPhone) && (
            <small className="text-danger d-block mb-2">
              Số điện thoại phải có 8–15 ký tự số, dấu cách hoặc dấu chấm.
            </small>
          )}
          <label className="form-label">Ghi chú</label>
          <textarea
            className="form-control"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="text-danger mt-2">{error}</p>}
        </Modal.Body>
        <Modal.Footer>
          <button className="btn btn-outline-secondary" onClick={() => setSell(null)}>
            Đóng
          </button>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              !validQuantity(quantity) ||
              !contactName.trim() ||
              !validContactPhone(contactPhone)
            }
            onClick={() => void placeSell()}
          >
            Gửi đơn
          </button>
        </Modal.Footer>
      </Modal>
      {!own && <StorefrontCartBar dealerId={dealer.id} />}
    </>
  );
}
