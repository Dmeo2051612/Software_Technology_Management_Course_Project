import { useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonState } from '../../../components/ui';
import { matchingApi } from '../../../services/agrilink-matching.service';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { CreateDealerLeadOffer, Crop, DealerLead, DealerLeadOffer, IntentSide, Slot } from '../../../services/agrilink-matching.types';
import type { ProductListing } from '../../../services/agrilink.types';
import { useAuthStore } from '../../../stores/authStore';
import { showToast } from '../../../stores/toastStore';
import { fmtDate, toLocalDateString } from '../../../utils/formatters';
import { formatMatchingVND, slotLabel } from '../buyer/matchingLogic';
import { fulfillmentLabel } from '../labels';
import './dealerPages.css';

const offerStatus = { pending: 'Đang chờ', accepted: 'Đã chấp nhận', declined: 'Đã từ chối', withdrawn: 'Đã rút', expired: 'Hết hiệu lực' };

function OfferDrawer({ lead, products, ownOrgId, onClose, onSent }: {
  lead: DealerLead; products: ProductListing[]; ownOrgId: string;
  onClose: () => void; onSent: () => void;
}) {
  const [price, setPrice] = useState('');
  const [fulfillment, setFulfillment] = useState<CreateDealerLeadOffer['fulfillment']>(lead.side === 'sell' ? 'at_dealer' : 'pickup');
  const [slot, setSlot] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [fee, setFee] = useState('0');
  const [message, setMessage] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const usesService = lead.side === 'sell' ? fulfillment === 'delivery' : fulfillment === 'delivery';
  useEffect(() => {
    if (!usesService) { setSlots([]); setSlot(''); return; }
    const today = toLocalDateString(new Date());
    const from = lead.windowStart > today ? lead.windowStart : today;
    const cap = new Date(`${from}T00:00:00Z`);
    cap.setUTCDate(cap.getUTCDate() + 13);
    const to = lead.windowEnd < cap.toISOString().slice(0, 10) ? lead.windowEnd : cap.toISOString().slice(0, 10);
    if (to < from) { setError('Khoảng ngày của nhu cầu đã hết hạn.'); return; }
    void matchingApi.availability(ownOrgId, lead.side === 'sell' ? 'farm_pickup' : 'supply_delivery', from, to)
      .then((items) => { setSlots(items); setError(''); }).catch((e) => setError(apiError(e)));
  }, [fulfillment, lead, ownOrgId, usesService]);
  const send = async () => {
    if (busy) return;
    const selected = slots.find((item) => `${item.date}:${item.session}` === slot);
    if (usesService && !selected) return setError('Chọn buổi còn chỗ.');
    if (lead.side === 'sell' && (!price || Number(price) <= 0)) return setError('Nhập giá thu mua hợp lệ.');
    if (lead.side === 'buy' && (!productId || Number(quantity) <= 0)) return setError('Chọn sản phẩm và số lượng.');
    if (!Number.isFinite(Number(fee)) || Number(fee) < 0) return setError('Phí phải từ 0 trở lên.');
    const input: CreateDealerLeadOffer = {
      fulfillment, feePerKg: Math.round(Number(fee)), message: message.trim(),
      ...(lead.side === 'sell' ? { pricePerKg: Math.round(Number(price)) } : { products: [{ offerId: productId, quantity: Number(quantity) }] }),
      ...(selected ? { scheduledDate: selected.date, scheduledSession: selected.session } : {}),
    };
    setBusy(true);
    try {
      await matchingApi.createLeadOffer(lead.intentId, input);
      showToast('success', 'Đã gửi đề nghị');
      onSent();
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  return <div className="agrilink-drawer-backdrop" onMouseDown={onClose}>
    <section className="agrilink-drawer" role="dialog" aria-modal="true" aria-label="Gửi đề nghị" onMouseDown={(event) => event.stopPropagation()}>
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <h2 className="h5">Gửi đề nghị</h2>
          <p className="text-muted">{lead.crop?.name || lead.productQuery} · {lead.communeName ? `${lead.communeName}, ` : ''}{lead.provinceName}</p>
        </div>
        <button className="btn btn-outline-secondary btn-sm" onClick={onClose}>Đóng</button>
      </div>
      <p className="alert alert-info">Thông tin người đăng được ẩn. Bạn sẽ nhận liên hệ khi đề nghị được chấp nhận.</p>
      <div className="agrilink-drawer-fields">
        {lead.side === 'sell' ? <label className="form-label">Giá đề nghị (đ/kg)<input className="form-control" type="number" min="1" step="1" value={price} onChange={(event) => setPrice(event.target.value)} />
        </label> : <>
          <label className="form-label">Sản phẩm đăng bán<select className="form-select" value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Chọn sản phẩm</option>{products.filter((item) => item.published && item.inStock).map((item) => <option value={item.productId} key={item.productId}>{item.name}</option>)}</select>
          </label>
          <label className="form-label">Số lượng<input className="form-control" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
        </>}
        <label className="form-label">Hình thức<select className="form-select" value={fulfillment} onChange={(event) => setFulfillment(event.target.value as CreateDealerLeadOffer['fulfillment'])}>{(lead.side === 'sell' ? ['at_dealer', 'delivery'] : ['pickup', 'delivery']).map((option) =>
          <option value={option} key={option}>{fulfillmentLabel(lead.side, option as CreateDealerLeadOffer['fulfillment'])}</option>
        )}</select>
        </label>
        {usesService && <label className="form-label">Buổi còn chỗ<select className="form-select" value={slot} onChange={(event) => setSlot(event.target.value)}>
          <option value="">Chọn buổi</option>{slots.map((item) => <option key={`${item.date}:${item.session}`} value={`${item.date}:${item.session}`}>{slotLabel(item)} · còn {item.remaining}</option>)}</select>
        </label>}
        <label className="form-label">Phí (đ/kg)<input className="form-control" type="number" min="0" step="1" value={fee} onChange={(event) => setFee(event.target.value)} />
        </label>
        <label className="form-label">Lời nhắn<textarea className="form-control" rows={3} maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
      </div>
      {error && <p className="text-danger mt-3">{error}</p>}
      <div className="agrilink-drawer-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void send()}>Gửi đề nghị</button>
      </div>
    </section>
  </div>;
}

export default function LeadsPage() {
  const ownOrgId = useAuthStore((state) => state.user?.organizationId);
  const [side, setSide] = useState<IntentSide>('sell');
  const [cropId, setCropId] = useState('');
  const [crops, setCrops] = useState<Crop[]>([]);
  const [leads, setLeads] = useState<DealerLead[] | null>(null);
  const [offers, setOffers] = useState<DealerLeadOffer[]>([]);
  const [products, setProducts] = useState<ProductListing[]>([]);
  const [selected, setSelected] = useState<DealerLead | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const refresh = () => {
    void Promise.all([matchingApi.leads(side), matchingApi.leadOffers()])
      .then(([currentLeads, currentOffers]) => {
        setLeads(currentLeads);
        setOffers(currentOffers);
        setError('');
      })
      .catch((e) => setError(apiError(e)));
  };
  useEffect(refresh, [side]);
  useEffect(() => {
    void matchingApi.crops().then(setCrops).catch((e) => setError(apiError(e)));
    void agrilinkManageApi.products({ published: true, limit: 100 }).then((result) => setProducts(result.items)).catch((e) => setError(apiError(e)));
  }, []);
  const withdraw = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try { await matchingApi.withdrawLeadOffer(id); refresh(); showToast('success', 'Đã rút đề nghị'); }
    catch (e) { setError(apiError(e)); } finally { setBusy(''); }
  };
  const visibleLeads = leads?.filter((lead) => !cropId || lead.crop?.id === cropId);
  const cropCounts = new Map<string, { name: string; count: number }>();
  leads?.forEach((lead) => {
    if (!lead.crop) return;
    const current = cropCounts.get(lead.crop.id);
    cropCounts.set(lead.crop.id, { name: lead.crop.name, count: (current?.count || 0) + 1 });
  });
  const pendingIntentIds = new Set(offers.filter((offer) => offer.status === 'pending').map((offer) => offer.intentId));
  return <>
    <PageHeader title="Nguồn hàng gợi ý" subtitle="Nhu cầu đang mở phù hợp với tin thu mua và vùng phục vụ của đại lý. Thông tin người đăng được ẩn." />
    <div className="btn-group mb-3" role="group" aria-label="Loại nhu cầu">
      <button className={`btn ${side === 'sell' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setSide('sell'); setCropId(''); }}>Bán nông sản</button>
      <button className={`btn ${side === 'buy' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setSide('buy'); setCropId(''); }}>Mua vật tư</button>
    </div>
    {side === 'sell' && <div className="d-flex flex-wrap gap-2 mb-3">
      <button className={`btn btn-sm ${!cropId ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setCropId('')}>Tất cả ({leads?.length || 0})</button>
      {[...cropCounts].map(([id, crop]) => <button key={id} className={`btn btn-sm ${cropId === id ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setCropId(id)}>{crop.name} ({crop.count})</button>)}
    </div>}
    {error && <p className="text-danger">{error}</p>}
    {!visibleLeads ? <SkeletonState variant="table" rows={5} /> : visibleLeads.length === 0 ? <EmptyState title="Chưa có nguồn hàng phù hợp" /> : <div className="card mb-4">
      <div className="table-responsive">
        <table className="table align-middle mb-0">
          <thead>
            <tr>
              <th>Nhu cầu</th>
              <th>Khu vực</th>
              <th>Khối lượng</th>
              <th>Thời gian</th>
              <th>Giá mong muốn</th>
              <th>
              </th>
            </tr>
          </thead>
          <tbody>{visibleLeads.map((lead) => <tr key={lead.intentId}>
            <td>
              <strong>{lead.crop?.name || lead.productQuery}</strong>
            </td>
            <td>{lead.communeName ? `${lead.communeName}, ` : ''}{lead.provinceName}{lead.distanceKm != null && <small className="d-block text-muted">{lead.distanceKm} km</small>}</td>
            <td>{lead.quantityKg ? `${lead.quantityKg.toLocaleString('vi-VN')} kg` : lead.quantityText || '—'}</td>
            <td>{fmtDate(lead.windowStart)} – {fmtDate(lead.windowEnd)}</td>
            <td>{lead.expectedPricePerKg == null ? '—' : `${formatMatchingVND(lead.expectedPricePerKg)}/kg`}</td>
            <td>
              <button className={`btn btn-sm ${pendingIntentIds.has(lead.intentId) ? 'btn-outline-secondary' : 'btn-primary'}`} disabled={!ownOrgId || pendingIntentIds.has(lead.intentId)} onClick={() => setSelected(lead)}>
                {pendingIntentIds.has(lead.intentId) ? 'Đã gửi đề nghị' : 'Gửi đề nghị'}
              </button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
    <h2 className="h5 mb-3">Đề nghị đã gửi</h2>
    {offers.length === 0 ? <EmptyState title="Chưa gửi đề nghị" /> : <div className="card">
      <div className="table-responsive">
        <table className="table align-middle mb-0">
          <thead>
            <tr>
              <th>Nhu cầu</th>
              <th>Giá</th>
              <th>Hình thức</th>
              <th>Trạng thái</th>
              <th>
              </th>
            </tr>
          </thead>
          <tbody>{offers.map((offer) => <tr key={offer.id}>
            <td>{offer.intent.productQuery || crops.find((crop) => crop.id === offer.intent.cropId)?.name || 'Nông sản'}</td>
            <td>{offer.pricePerKg == null ? '—' : formatMatchingVND(offer.pricePerKg)}</td>
            <td>{fulfillmentLabel(offer.intent.side, offer.fulfillment)}</td>
            <td>{offerStatus[offer.status]}</td>
            <td>{offer.status === 'pending' && <button className="btn btn-outline-danger btn-sm" disabled={!!busy} onClick={() => void withdraw(offer.id)}>Rút đề nghị</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
    {selected && ownOrgId && <OfferDrawer lead={selected} products={products} ownOrgId={ownOrgId} onClose={() => setSelected(null)} onSent={() => { setSelected(null); refresh(); }} />}
  </>;
}
