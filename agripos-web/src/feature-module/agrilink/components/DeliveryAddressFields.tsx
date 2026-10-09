import { useEffect, useState } from 'react';
import { matchingApi } from '../../../services/agrilink-matching.service';
import type { Commune, Province } from '../../../services/agrilink-matching.types';

export interface DeliveryAddress {
  provinceCode: string;
  communeCode: string;
  /** Thôn / ấp / tổ (không bắt buộc). */
  hamlet: string;
  /** Số nhà, tên đường. */
  street: string;
}
export const emptyAddress: DeliveryAddress = { provinceCode: '', communeCode: '', hamlet: '', street: '' };

let provinceCache: Promise<Province[]> | null = null;
const loadProvinces = () => (provinceCache ??= matchingApi.provinces().catch((e) => ((provinceCache = null), Promise.reject(e))));
const communeCache = new Map<string, Promise<Commune[]>>();
const loadCommunes = (code: string) => {
  if (!communeCache.has(code))
    communeCache.set(code, matchingApi.communes(code).catch((e) => (communeCache.delete(code), Promise.reject(e))));
  return communeCache.get(code)!;
};

/** Lỗi đầu tiên còn thiếu, hoặc '' khi đủ thông tin giao hàng. */
export function addressError(a: DeliveryAddress): string {
  if (!a.provinceCode) return 'Vui lòng chọn tỉnh / thành phố giao hàng.';
  if (!a.communeCode) return 'Vui lòng chọn xã / phường giao hàng.';
  if (a.street.trim().length < 3) return 'Vui lòng nhập số nhà, tên đường (hoặc mô tả vị trí).';
  return '';
}

/** Ghép địa chỉ thành một dòng gửi kèm đơn: "Số nhà đường, Thôn, Xã, Tỉnh". */
export async function formatAddress(a: DeliveryAddress): Promise<string> {
  const [provinces, communes] = await Promise.all([loadProvinces(), a.provinceCode ? loadCommunes(a.provinceCode) : []]);
  const commune = communes.find((c) => c.code === a.communeCode)?.name;
  const province = provinces.find((p) => p.code === a.provinceCode)?.name;
  return [a.street, a.hamlet, commune, province].map((x) => x?.trim()).filter(Boolean).join(', ').slice(0, 250);
}

/** Ô nhập địa chỉ giao hàng theo cấp hành chính sau sáp nhập: tỉnh → xã → thôn → số nhà, đường. */
export default function DeliveryAddressFields({
  value,
  onChange,
  idPrefix,
}: {
  value: DeliveryAddress;
  onChange: (next: DeliveryAddress) => void;
  idPrefix: string;
}) {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    void loadProvinces().then(setProvinces).catch(() => setLoadError('Không tải được danh sách tỉnh / thành.'));
  }, []);
  useEffect(() => {
    if (!value.provinceCode) {
      setCommunes([]);
      return;
    }
    let active = true;
    void loadCommunes(value.provinceCode)
      .then((list) => active && setCommunes(list))
      .catch(() => active && setLoadError('Không tải được danh sách xã / phường.'));
    return () => {
      active = false;
    };
  }, [value.provinceCode]);
  const set = (patch: Partial<DeliveryAddress>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="delivery-address">
      <legend className="form-label">Địa chỉ giao hàng</legend>
      <div className="row g-2">
        <div className="col-md-6">
          <label className="form-label small text-muted" htmlFor={`${idPrefix}-province`}>Tỉnh / thành phố</label>
          <select
            id={`${idPrefix}-province`}
            className="form-select"
            value={value.provinceCode}
            onChange={(e) => set({ provinceCode: e.target.value, communeCode: '' })}
            required
          >
            <option value="">Chọn tỉnh / thành phố</option>
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label small text-muted" htmlFor={`${idPrefix}-commune`}>Xã / phường</label>
          <select
            id={`${idPrefix}-commune`}
            className="form-select"
            value={value.communeCode}
            disabled={!value.provinceCode}
            onChange={(e) => set({ communeCode: e.target.value })}
            required
          >
            <option value="">{value.provinceCode ? 'Chọn xã / phường' : 'Chọn tỉnh trước'}</option>
            {communes.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="col-md-4">
          <label className="form-label small text-muted" htmlFor={`${idPrefix}-hamlet`}>Thôn / ấp / tổ (không bắt buộc)</label>
          <input
            id={`${idPrefix}-hamlet`}
            className="form-control"
            value={value.hamlet}
            maxLength={80}
            placeholder="VD: Ấp Tân Thành"
            onChange={(e) => set({ hamlet: e.target.value })}
          />
        </div>
        <div className="col-md-8">
          <label className="form-label small text-muted" htmlFor={`${idPrefix}-street`}>Số nhà, tên đường</label>
          <input
            id={`${idPrefix}-street`}
            className="form-control"
            value={value.street}
            maxLength={120}
            placeholder="VD: 45 Quốc lộ 91, gần chợ Thốt Nốt"
            onChange={(e) => set({ street: e.target.value })}
            required
          />
        </div>
      </div>
      {loadError && <small className="text-danger d-block mt-1">{loadError}</small>}
    </fieldset>
  );
}
