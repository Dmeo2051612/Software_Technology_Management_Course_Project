import { useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonState } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import { matchingApi } from '../../../services/agrilink-matching.service';
import type { BuyOffer } from '../../../services/agrilink.types';
import type { Crop } from '../../../services/agrilink-matching.types';
import { showToast } from '../../../stores/toastStore';
import { formatMatchingVND } from '../buyer/matchingLogic';
import { commodityLabels } from '../labels';
import './dealerPages.css';

type OfferForm = { cropId: string; title: string; price: string; unit: string; maxQuantityKg: string; validUntil: string; active: boolean };
const blank: OfferForm = { cropId: '', title: '', price: '', unit: 'kg', maxQuantityKg: '', validUntil: '', active: true };

function freshness(offer: BuyOffer) {
  if (offer.stale || offer.priceAgeHours >= 48) return { label: 'Đã ẩn khỏi tìm kiếm', className: 'text-danger' };
  if (offer.priceAgeHours >= 24) return { label: 'Hôm qua', className: 'text-warning' };
  return { label: 'Hôm nay', className: 'text-success' };
}
function marketText(offer: BuyOffer, price = offer.price) {
  if (!offer.market) return 'Chưa có giá tham chiếu thị trường';
  const pct = (price - offer.market.pricePerKg) / offer.market.pricePerKg * 100;
  const scope = offer.market.scope === 'province' ? offer.market.provinceName : 'khu vực';
  const difference = Math.abs(pct) < 0.05 ? 'bằng giá thị trường' : `${pct > 0 ? 'cao hơn' : 'thấp hơn'} ${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
  return `Thị trường ${scope}: ${formatMatchingVND(offer.market.pricePerKg)}/kg · ${difference}`;
}

function OfferDrawer({ offer, crops, busy, apiMessage, onClose, onSave, onStop }: {
  offer: BuyOffer | null; crops: Crop[]; busy: boolean; apiMessage: string;
  onClose: () => void; onSave: (form: OfferForm) => void; onStop: (offer: BuyOffer) => void;
}) {
  const [form, setForm] = useState<OfferForm>(() => offer ? {
    cropId: offer.cropId || '', title: offer.title, price: String(offer.price), unit: offer.unit,
    maxQuantityKg: offer.maxQuantityKg == null ? '' : String(offer.maxQuantityKg),
    validUntil: offer.validUntil?.slice(0, 10) || '', active: offer.active,
  } : blank);
  const [error, setError] = useState('');
  const set = (patch: Partial<OfferForm>) => setForm((current) => ({ ...current, ...patch }));
  const save = () => {
    if (busy) return;
    if (!offer && !form.cropId) return setError('Vui lòng chọn nông sản.');
    if (form.title.trim().length < 2 || !form.unit.trim() || !Number.isFinite(Number(form.price)) || Number(form.price) <= 0)
      return setError('Vui lòng nhập tiêu đề, đơn vị và giá hợp lệ.');
    if (form.maxQuantityKg && Number(form.maxQuantityKg) <= 0) return setError('Khối lượng tối đa phải lớn hơn 0.');
    setError('');
    onSave(form);
  };
  return <div className="agrilink-drawer-backdrop" onMouseDown={onClose}>
    <section className="agrilink-drawer" role="dialog" aria-modal="true" aria-label={offer ? 'Sửa tin thu mua' : 'Thêm tin thu mua'} onMouseDown={(event) => event.stopPropagation()}>
      <div className="d-flex align-items-start justify-content-between mb-4">
        <div>
          <h2 className="h5 mb-1">{offer ? 'Sửa tin thu mua' : 'Thêm tin thu mua'}</h2>
          <p className="text-muted mb-0">Giá được hiển thị cho nông dân trong 48 giờ.</p>
        </div>
        <button className="btn btn-outline-secondary btn-sm" onClick={onClose} aria-label="Đóng">×</button>
      </div>
      <div className="agrilink-drawer-fields">
        <label className="form-label">Nông sản
          <select className="form-select" value={form.cropId} disabled={!!offer} onChange={(event) => set({ cropId: event.target.value })}>
            <option value="">Chọn nông sản</option>
            {crops.map((crop) => <option key={crop.id} value={crop.id}>{crop.name}</option>)}
            {offer && !offer.cropId && <option value="">{offer.commodityType ? commodityLabels[offer.commodityType] : 'Tin cũ'}</option>}
          </select>
          {offer && <small className="text-muted">Đổi nông sản bằng cách tạo tin mới.</small>}
        </label>
        <label className="form-label">Tiêu đề<input className="form-control" maxLength={180} value={form.title} onChange={(event) => set({ title: event.target.value })} />
        </label>
        <label className="form-label">Giá thu mua (đ/kg)<input className="form-control" type="number" min="0" step="1" value={form.price} onChange={(event) => set({ price: event.target.value })} />{offer && <small className="text-muted">{marketText(offer, Number(form.price))}</small>}</label>
        <label className="form-label">Đơn vị<input className="form-control" value={form.unit} disabled={!!offer} onChange={(event) => set({ unit: event.target.value })} />{offer && <small className="text-muted">Đơn vị chỉ đặt khi tạo tin.</small>}</label>
        <label className="form-label">Khối lượng tối đa muốn mua (kg)<input className="form-control" type="number" min="0" step="0.001" value={form.maxQuantityKg} onChange={(event) => set({ maxQuantityKg: event.target.value })} />
        </label>
        <label className="form-label">Hiệu lực đến<input className="form-control" type="date" value={form.validUntil} onChange={(event) => set({ validUntil: event.target.value })} />
        </label>
        {offer && <label className="form-check form-switch">
          <input className="form-check-input" type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} />
          <span className="form-check-label">Đang nhận</span>
        </label>}
      </div>
      {(error || apiMessage) && <p className="text-danger mt-3" role="alert">{error || apiMessage}</p>}
      <div className="agrilink-drawer-actions">
        <button className="btn btn-primary" disabled={busy} onClick={save}>{offer ? 'Lưu thay đổi' : 'Thêm tin'}</button>
        {offer?.active && <button className="btn btn-outline-danger" disabled={busy} onClick={() => onStop(offer)}>Ngừng nhận tin này</button>}
      </div>
    </section>
  </div>;
}

export default function BuyOffersPage() {
  const [offers, setOffers] = useState<BuyOffer[] | null>(null);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [drawer, setDrawer] = useState<BuyOffer | 'new' | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => setOffers(await agrilinkManageApi.buyOffers());
  useEffect(() => {
    void refresh().catch((e) => setError(apiError(e)));
    void matchingApi.crops().then(setCrops).catch((e) => setError(apiError(e)));
  }, []);
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refresh();
      showToast('success', success);
      setDrawer(null);
      setEditing(null);
      setError('');
    } catch (e) {
      setError(apiError(e));
      showToast('error', apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (form: OfferForm) => {
    const common = {
      title: form.title.trim(), price: Number(form.price),
      maxQuantityKg: form.maxQuantityKg ? Number(form.maxQuantityKg) : null,
      validUntil: form.validUntil || null,
    };
    if (drawer && drawer !== 'new') {
      void run(() => agrilinkManageApi.updateBuyOffer(drawer.id, { ...common, active: form.active }), 'Đã cập nhật tin thu mua');
    } else {
      void run(() => agrilinkManageApi.addBuyOffer({
        cropId: form.cropId, title: common.title, unit: form.unit.trim(), price: common.price,
        ...(common.maxQuantityKg != null ? { maxQuantityKg: common.maxQuantityKg } : {}),
        ...(common.validUntil ? { validUntil: common.validUntil } : {}),
      }), 'Đã thêm tin thu mua');
    }
  };
  const soon = offers?.filter((offer) => offer.active && !offer.stale && offer.priceAgeHours >= 36).length || 0;
  const stale = offers?.filter((offer) => offer.active && (offer.stale || offer.priceAgeHours >= 48)).length || 0;
  return <>
    <PageHeader title="Tin thu mua" subtitle="Giá hiển thị cho nông dân khi được cập nhật hoặc xác nhận trong vòng 48 giờ." />
    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
      <button className="btn btn-primary" disabled={busy} onClick={() => setDrawer('new')}>
        <i className="ti ti-plus me-1" />Thêm tin thu mua</button>
      <button className="btn btn-outline-primary" disabled={busy || !offers?.length} onClick={() => void run(agrilinkManageApi.confirmAllBuyOffers, 'Đã giữ giá hôm nay cho tất cả')}>Giữ giá hôm nay cho tất cả</button>
      <span className="text-muted ms-auto">{offers?.length || 0} tin · {soon} sắp hết hạn · {stale} đã ẩn</span>
    </div>
    {error && <p className="text-danger">{error}</p>}
    {!offers ? <SkeletonState variant="table" rows={5} /> : offers.length === 0 ? <EmptyState title="Chưa có tin thu mua" /> : <div className="card">
      <div className="table-responsive">
        <table className="table align-middle mb-0">
          <thead>
            <tr>
              <th>Nông sản / tin thu mua</th>
              <th>Giá thu mua</th>
              <th>Độ mới giá</th>
              <th>Trạng thái</th>
              <th>
              </th>
            </tr>
          </thead>
          <tbody>{offers.map((offer) => <tr key={offer.id}>
            <td>
              <strong>{crops.find((crop) => crop.id === offer.cropId)?.name || (offer.commodityType ? commodityLabels[offer.commodityType] : 'Nông sản')}</strong>
              <small className="d-block text-muted">{offer.title}</small>
            </td>
            <td className="agrilink-price-cell">{editing === offer.id ? <div className="d-flex align-items-center gap-1">
              <input className="form-control form-control-sm" type="number" min="0" step="1" value={price} disabled={busy} onChange={(event) => setPrice(event.target.value)} aria-label={`Giá ${offer.title}`} />
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { const amount = Number(price); if (price.trim() && Number.isFinite(amount) && amount > 0) void run(() => agrilinkManageApi.updateBuyOffer(offer.id, { price: amount }), 'Đã cập nhật giá'); else setError('Giá phải lớn hơn 0.'); }}>Lưu</button>
              <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setEditing(null)}>Hủy</button>
            </div> : <button className="btn btn-link p-0 text-decoration-none" disabled={busy} onClick={() => { setEditing(offer.id); setPrice(String(offer.price)); }}>{formatMatchingVND(offer.price)}/{offer.unit} <i className="ti ti-pencil" />
            </button>}<small className="d-block text-muted">{marketText(offer, editing === offer.id ? Number(price) : offer.price)}</small>
            </td>
            <td>
              <span className={freshness(offer).className}>{freshness(offer).label}</span>
            </td>
            <td>
              <span className={`badge ${offer.active ? 'bg-success' : 'bg-secondary'}`}>{offer.active ? 'Đang nhận' : 'Đã ngừng'}</span>
            </td>
            <td>
              <div className="d-flex gap-1">
                <button className="btn btn-outline-primary btn-sm" disabled={busy || !offer.active} onClick={() => void run(() => agrilinkManageApi.confirmBuyOffer(offer.id), 'Đã giữ giá hôm nay')}>Giữ giá</button>
                <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setDrawer(offer)}>Sửa</button>
              </div>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
    {drawer && <OfferDrawer key={drawer === 'new' ? 'new' : drawer.id} offer={drawer === 'new' ? null : drawer} crops={crops} busy={busy} apiMessage={error} onClose={() => setDrawer(null)} onSave={save} onStop={(offer) => void run(() => agrilinkManageApi.removeBuyOffer(offer.id), 'Đã ngừng nhận tin')} />}
  </>;
}
