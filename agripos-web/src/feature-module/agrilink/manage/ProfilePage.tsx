import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader, SkeletonState } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import { matchingApi } from '../../../services/agrilink-matching.service';
import type { Commune, Province } from '../../../services/agrilink-matching.types';
import type { DealerProfile, Fulfillment } from '../../../services/agrilink.types';
import { useAuthStore } from '../../../stores/authStore';
import { showToast } from '../../../stores/toastStore';
import { DealerCover } from '../components/DealerCover';
import { fulfillmentLabels } from '../labels';
import { profilePatch } from './profilePatch';

function ProfileFields({
  form,
  set,
  toggle,
  provinces,
  communes,
}: {
  form: DealerProfile;
  set: (patch: Partial<DealerProfile>) => void;
  toggle: (option: Fulfillment) => void;
  provinces: Province[];
  communes: Commune[];
}) {
  const fields = [
    ['name', 'Tên đại lý'],
    ['region', 'Khu vực'],
    ['address', 'Địa chỉ'],
    ['phone', 'Số điện thoại'],
    ['openingHours', 'Giờ mở cửa'],
  ] as const;
  return (
    <div className="row g-3">
      {fields.map(([key, label]) => (
        <div className="col-md-6" key={key}>
          <label className="form-label">{label}</label>
          <input
            className="form-control"
            value={form[key]}
            onChange={(e) => set({ [key]: e.target.value })}
          />
        </div>
      ))}
      <div className="col-md-6"><label className="form-label">Tỉnh / thành
        <select className="form-select" value={form.provinceCode || ''} onChange={(e) => set({ provinceCode: e.target.value || null, communeCode: null })}>
          <option value="">Chọn tỉnh / thành</option>
          {provinces.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}
        </select>
      </label></div>
      <div className="col-md-6"><label className="form-label">Xã / phường
        <select className="form-select" value={form.communeCode || ''} disabled={!form.provinceCode} onChange={(e) => set({ communeCode: e.target.value || null })}>
          <option value="">Chọn xã / phường</option>
          {communes.map((commune) => <option key={commune.code} value={commune.code}>{commune.name}</option>)}
        </select>
      </label></div>
      <div className="col-md-6"><label className="form-label">Vĩ độ (tùy chọn)<input className="form-control" type="number" min="8" max="24" step="0.000001" value={form.lat ?? ''} onChange={(e) => set({ lat: e.target.value ? Number(e.target.value) : null })} /></label></div>
      <div className="col-md-6"><label className="form-label">Kinh độ (tùy chọn)<input className="form-control" type="number" min="102" max="110" step="0.000001" value={form.lng ?? ''} onChange={(e) => set({ lng: e.target.value ? Number(e.target.value) : null })} /></label></div>
      <div className="col-12">
        <label className="form-label">Mô tả</label>
        <textarea
          className="form-control"
          rows={4}
          value={form.bio}
          onChange={(e) => set({ bio: e.target.value })}
        />
      </div>
      <div className="col-12">
        <label className="form-label d-block">Hình thức nhận hàng</label>
        {(['pickup', 'delivery', 'at_dealer'] as const).map((option) => (
          <label className="form-check form-check-inline" key={option}>
            <input
              className="form-check-input"
              type="checkbox"
              checked={form.fulfillmentOptions.includes(option)}
              onChange={() => toggle(option)}
            />
            <span className="form-check-label">{fulfillmentLabels[option]}</span>
          </label>
        ))}
      </div>
      <div className="col-12">
        <label className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            checked={form.marketplaceEnabled}
            onChange={(e) => set({ marketplaceEnabled: e.target.checked })}
          />
          <span className="form-check-label">Hiển thị trên AgriLink</span>
        </label>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [saved, setSaved] = useState<DealerProfile | null>(null);
  const [form, setForm] = useState<DealerProfile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const dirty = !!saved && !!form && JSON.stringify(saved) !== JSON.stringify(form);

  // TODO(agrilink): Add a router-level blocker when BrowserRouter becomes a data router.
  useEffect(() => {
    agrilinkManageApi
      .profile()
      .then((data) => {
        setSaved(data);
        setForm(data);
      })
      .catch((e) => setError(apiError(e)));
  }, []);
  useEffect(() => { void matchingApi.provinces().then(setProvinces).catch((e) => setError(apiError(e))); }, []);
  useEffect(() => {
    if (!form?.provinceCode) { setCommunes([]); return; }
    void matchingApi.communes(form.provinceCode).then(setCommunes).catch((e) => setError(apiError(e)));
  }, [form?.provinceCode]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null;
      if (
        link &&
        link.target !== '_blank' &&
        link.origin === window.location.origin &&
        link.pathname !== location.pathname &&
        !window.confirm('Bạn có thay đổi chưa lưu. Rời trang?')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, location.pathname]);

  const set = (patch: Partial<DealerProfile>) => setForm((s) => (s ? { ...s, ...patch } : s));
  const toggle = (option: Fulfillment) => {
    if (!form) return;
    const next = form.fulfillmentOptions.includes(option)
      ? form.fulfillmentOptions.filter((x) => x !== option)
      : [...form.fulfillmentOptions, option];
    set({ fulfillmentOptions: next });
  };
  const upload = async (file: File, kind: 'logo' | 'cover' = 'logo') => {
    const maxMb = kind === 'logo' ? 2 : 5;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > maxMb * 1024 * 1024
    ) {
      setError(`${kind === 'logo' ? 'Logo' : 'Ảnh bìa'} phải là ảnh JPG, PNG hoặc WebP, tối đa ${maxMb} MB.`);
      return;
    }
    setBusy(true);
    try {
      const patch =
        kind === 'logo'
          ? { logoUrl: (await agrilinkManageApi.uploadLogo(file)).logoUrl }
          : { coverUrl: (await agrilinkManageApi.uploadCover(file)).coverUrl };
      set(patch);
      setSaved((s) => (s ? { ...s, ...patch } : s));
      showToast('success', kind === 'logo' ? 'Đã tải logo lên' : 'Đã đổi ảnh bìa');
      setError('');
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (busy || !form || !saved) return;
    if ((form.lat == null) !== (form.lng == null)) { setError('Vĩ độ và kinh độ phải nhập cùng nhau.'); return; }
    if (!form.fulfillmentOptions.length) {
      setError('Chọn ít nhất một hình thức nhận hàng.');
      return;
    }
    const patch = profilePatch(saved, form);
    if (!Object.keys(patch).length) {
      setSaved(form);
      return;
    }
    setBusy(true);
    try {
      const result = await agrilinkManageApi.updateProfile(patch);
      setSaved(result);
      setForm(result);
      setError('');
      showToast('success', 'Đã lưu thông tin đại lý');
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Thông tin đại lý"
        actions={
          user?.organizationId && (
            <Link
              className="btn btn-outline-primary"
              to={`/agrilink/dai-ly/${user.organizationId}`}
              target="_blank"
            >
              Xem gian hàng
            </Link>
          )
        }
      />
      {!form ? (
        <SkeletonState variant="detail" />
      ) : (
        <div className="card p-0 overflow-hidden">
          <DealerCover coverUrl={form.coverUrl} logoUrl={form.logoUrl} variant="hero">
            <input
              ref={coverRef}
              className="d-none"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file, 'cover');
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="btn btn-light btn-sm dealer-cover-action"
              onClick={() => coverRef.current?.click()}
              disabled={busy}
            >
              <i className="ti ti-camera me-1" aria-hidden="true" />
              {form.coverUrl ? 'Đổi ảnh bìa' : 'Thêm ảnh bìa'}
            </button>
          </DealerCover>
          <div className="card-body p-4">
            <div className="d-flex align-items-center gap-3 mb-4">
              <div>
                <input
                  ref={fileRef}
                  className="d-none"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <button
                  className="btn btn-outline-primary"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  Tải logo
                </button>
                <small className="d-block text-muted mt-1">Logo: JPG, PNG, WebP · tối đa 2 MB. Ảnh bìa nên ngang 1600×600, tối đa 5 MB.</small>
              </div>
            </div>
            <ProfileFields form={form} set={set} toggle={toggle} provinces={provinces} communes={communes} />
            {error && <p className="text-danger mt-3">{error}</p>}
            <button
              className="btn btn-primary mt-3"
              disabled={busy || !dirty}
              onClick={() => void save()}
            >
              Lưu thông tin
            </button>
          </div>
        </div>
      )}
    </>
  );
}
