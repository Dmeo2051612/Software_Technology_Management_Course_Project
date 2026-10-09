import { useEffect, useState } from 'react';
import { PageHeader, SkeletonState } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import { matchingApi } from '../../../services/agrilink-matching.service';
import type { DealerService, ServiceKind } from '../../../services/agrilink.types';
import type { Crop, Province } from '../../../services/agrilink-matching.types';
import { showToast } from '../../../stores/toastStore';
import './dealerPages.css';

const kinds: ServiceKind[] = ['farm_pickup', 'supply_delivery'];
const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const sessions = ['morning', 'afternoon'] as const;
const defaults = (kind: ServiceKind): DealerService => ({
  kind, active: false, cropIds: [], areaMode: 'provinces', radiusKm: null,
  provinceCodes: [], feeMode: 'free', feeAmount: 0, minQuantityKg: 0,
  leadTimeHours: 0, note: '', windows: [],
});

function ServiceCard({ initial, kind, crops, provinces }: {
  initial: DealerService | null; kind: ServiceKind; crops: Crop[]; provinces: Province[];
}) {
  const [form, setForm] = useState<DealerService>(initial || defaults(kind));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setForm(initial || defaults(kind)), [initial, kind]);
  const set = (patch: Partial<DealerService>) => setForm((current) => ({ ...current, ...patch }));
  const toggle = (key: 'cropIds' | 'provinceCodes', value: string) =>
    set({ [key]: form[key].includes(value) ? form[key].filter((item) => item !== value) : [...form[key], value] });
  const capacity = (weekday: number, session: 'morning' | 'afternoon') =>
    form.windows.find((window) => window.weekday === weekday && window.session === session)?.capacity || 0;
  const setCapacity = (weekday: number, session: 'morning' | 'afternoon', raw: string) => {
    const value = Number(raw);
    set({
      windows: [
        ...form.windows.filter((window) => window.weekday !== weekday || window.session !== session),
        ...(value > 0 ? [{ weekday, session, capacity: value }] : []),
      ]
    });
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const { kind: _kind, ...input } = form;
    void _kind;
    try {
      const saved = await agrilinkManageApi.putService(kind, {
        ...input,
        cropIds: kind === 'farm_pickup' ? input.cropIds : [],
        radiusKm: input.areaMode === 'radius' ? input.radiusKm : null,
        feeAmount: input.feeMode === 'free' ? 0 : Math.round(input.feeAmount),
      });
      setForm(saved);
      showToast('success', 'Đã lưu dịch vụ và lịch');
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  };
  return <section className="card mb-4">
    <div className="card-body p-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 className="h5 mb-1">{kind === 'farm_pickup' ? 'Lấy hàng tại vườn' : 'Giao vật tư'}</h2>
          <p className="text-muted mb-0">Thiết lập vùng phục vụ, phí và sức chứa theo buổi.</p>
        </div>
        <label className="form-check form-switch">
          <input className="form-check-input" type="checkbox" checked={form.active} onChange={(event) => set({ active: event.target.checked })} />
          <span className="form-check-label">{form.active ? 'Đang phục vụ' : 'Tạm ngưng'}</span>
        </label>
      </div>
      {kind === 'farm_pickup' && <div className="mb-3">
        <strong className="d-block mb-2">Nông sản nhận lấy</strong>
        <div className="d-flex flex-wrap gap-2">{crops.map((crop) => <button key={crop.id} type="button" className={`btn btn-sm ${form.cropIds.includes(crop.id) ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => toggle('cropIds', crop.id)}>{crop.name}</button>)}</div>
      </div>}
      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <label className="form-label">Vùng phục vụ<select className="form-select" value={form.areaMode} onChange={(event) => set({ areaMode: event.target.value as DealerService['areaMode'] })}>
            <option value="radius">Bán kính</option>
            <option value="provinces">Tỉnh / thành</option>
          </select>
          </label>
        </div>
        {form.areaMode === 'radius' && <div className="col-md-4">
          <label className="form-label">Bán kính (km)<input className="form-control" type="number" min="1" max="300" value={form.radiusKm ?? ''} onChange={(event) => set({ radiusKm: event.target.value ? Number(event.target.value) : null })} />
          </label>
        </div>}
        <div className="col-md-4">
          <label className="form-label">Cách tính phí<select className="form-select" value={form.feeMode} onChange={(event) => set({ feeMode: event.target.value as DealerService['feeMode'] })}>
            <option value="free">Miễn phí</option>
            <option value="per_trip">Theo chuyến</option>
            <option value="per_kg">Theo kg</option>
          </select>
          </label>
        </div>
        {form.feeMode !== 'free' && <div className="col-md-4">
          <label className="form-label">Mức phí (đ)<input className="form-control" type="number" min="0" step="1" value={form.feeAmount} onChange={(event) => set({ feeAmount: Number(event.target.value) })} />
          </label>
        </div>}
        <div className="col-md-4">
          <label className="form-label">Khối lượng tối thiểu (kg)<input className="form-control" type="number" min="0" step="0.001" value={form.minQuantityKg} onChange={(event) => set({ minQuantityKg: Number(event.target.value) })} />
          </label>
        </div>
        <div className="col-md-4">
          <label className="form-label">Báo trước (giờ)<input className="form-control" type="number" min="0" max="168" value={form.leadTimeHours} onChange={(event) => set({ leadTimeHours: Number(event.target.value) })} />
          </label>
        </div>
      </div>
      {form.areaMode === 'provinces' && <div className="mb-3">
        <strong className="d-block mb-2">Tỉnh / thành phục vụ</strong>
        <div className="agrilink-province-list">{provinces.map((province) => <label className="form-check" key={province.code}>
          <input className="form-check-input" type="checkbox" checked={form.provinceCodes.includes(province.code)} onChange={() => toggle('provinceCodes', province.code)} />
          <span className="form-check-label">{province.name}</span>
        </label>)}</div>
      </div>}
      <label className="form-label d-block">Ghi chú<textarea className="form-control" maxLength={500} rows={2} value={form.note} onChange={(event) => set({ note: event.target.value })} />
      </label>
      <h3 className="h6 mt-4">Sức chứa theo tuần</h3>
      <p className="text-muted">Để trống hoặc 0 để không nhận lịch buổi đó. Tối đa 50 lượt mỗi buổi.</p>
      <div className="table-responsive">
        <table className="table table-bordered align-middle text-center agrilink-week-grid">
          <thead>
            <tr>
              <th scope="col">Buổi</th>
              {days.map((day) => <th scope="col" key={day}>{day}</th>)}
            </tr>
          </thead>
          <tbody>{sessions.map((session) => <tr key={session}>
            <th scope="row">{session === 'morning' ? 'Sáng' : 'Chiều'}</th>
            {days.map((day, index) => {
              const weekday = (index + 1) % 7;
              return <td key={day}>
                <input className="form-control form-control-sm" type="number" min="0" max="50" step="1" value={capacity(weekday, session) || ''} onChange={(event) => setCapacity(weekday, session, event.target.value)} aria-label={`${day} ${session === 'morning' ? 'sáng' : 'chiều'}`} />
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {error && <p className="text-danger mt-2" role="alert">{error}</p>}
      <button className="btn btn-primary mt-2" disabled={busy} onClick={() => void save()}>Lưu dịch vụ</button>
    </div>
  </section>;
}

export default function ServicesPage() {
  const [services, setServices] = useState<(DealerService | null)[] | null>(null);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([agrilinkManageApi.services(), matchingApi.crops(), matchingApi.provinces()])
      .then(([serviceData, cropData, provinceData]) => { setServices(serviceData); setCrops(cropData); setProvinces(provinceData); })
      .catch((e) => setError(apiError(e)));
  }, []);
  return <>
    <PageHeader title="Dịch vụ & lịch" subtitle="Cho nông dân biết bạn phục vụ ở đâu và khi nào còn chỗ." />{error && <p className="text-danger">{error}</p>}{!services ? <SkeletonState variant="cards" count={2} /> : kinds.map((kind, index) => <ServiceCard key={kind} kind={kind} initial={services[index]} crops={crops} provinces={provinces} />)}</>;
}
