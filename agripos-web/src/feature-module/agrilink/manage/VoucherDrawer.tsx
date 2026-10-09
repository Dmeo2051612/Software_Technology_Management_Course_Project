import { useEffect, useState } from 'react';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { ManagedVoucher } from '../../../services/agrilink.types';
import { formatMoney } from '../../../utils/formatters';
import VoucherCard from '../components/VoucherCard';
import { saleEndIso } from '../listing';
import { vnDayMonth } from '../voucher';
import { addDays, initialVoucherForm, vnToday, voucherFormInput, voucherPatch, type VoucherForm } from './voucherForm';

const MAX_DAYS = 180;

function MoneyInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="input-group">
      <input
        className="form-control"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(formatMoney(e.target.value))}
      />
      <span className="input-group-text">₫</span>
    </div>
  );
}

export default function VoucherDrawer({
  voucher,
  onClose,
  onSaved,
}: {
  voucher: ManagedVoucher | null;
  onClose: () => void;
  onSaved: (saved: ManagedVoucher) => void;
}) {
  const [form, setForm] = useState<VoucherForm>(() => initialVoucherForm(voucher));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (patch: Partial<VoucherForm>) => setForm((f) => ({ ...f, ...patch }));
  // Voucher đã có người dùng thì giữ nguyên quy tắc giảm để công bằng với khách.
  const locked = !!voucher && voucher.usedCount > 0;
  const input = voucherFormInput(form);
  const today = vnToday();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!input.title) return setError('Nhập tên voucher.');
    if (!(input.value > 0)) return setError('Nhập mức giảm.');
    if (!(input.quantity > 0)) return setError('Nhập số lượt dùng.');
    if (!form.start || !form.end) return setError('Chọn ngày bắt đầu và kết thúc.');
    setBusy(true);
    setError('');
    try {
      let saved: ManagedVoucher;
      if (!voucher) saved = await agrilinkManageApi.createVoucher(input);
      else {
        const patch = voucherPatch(voucher, form);
        saved = Object.keys(patch).length ? await agrilinkManageApi.updateVoucher(voucher.id, patch) : voucher;
      }
      onSaved(saved);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const heading = voucher ? 'Sửa voucher' : 'Tạo voucher';
  return (
    <div className="agrilink-drawer-backdrop" onMouseDown={onClose}>
      <section
        className="agrilink-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
          <h5 className="mb-0">{heading}</h5>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
            Đóng
          </button>
        </div>
        {locked && (
          <p className="listing-note">
            Đã có {voucher.usedCount} lượt dùng — chỉ sửa được tên, số lượt và ngày kết thúc.
          </p>
        )}
        <div className="agrilink-drawer-fields">
          <label className="form-label">
            Tên voucher
            <input
              className="form-control"
              maxLength={80}
              placeholder="VD: Giảm 20K cho đơn từ 500K"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
            />
            <small className="text-muted">Khách thấy tên này ở gian hàng và giỏ hàng.</small>
          </label>
          <div>
            <div className="form-label">Loại giảm</div>
            <div className="btn-group mt-1" role="group" aria-label="Loại giảm">
              {(
                [
                  ['amount', 'Giảm số tiền'],
                  ['percent', 'Giảm theo %'],
                ] as const
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  disabled={locked}
                  className={`btn btn-sm ${form.type === type ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => update({ type, value: '', maxDiscount: '' })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="row g-3">
            <div className="col-6">
              <label className="form-label">
                Mức giảm
                {form.type === 'amount' ? (
                  <MoneyInput label="Mức giảm" value={form.value} disabled={locked} onChange={(value) => update({ value })} />
                ) : (
                  <div className="input-group">
                    <input
                      className="form-control"
                      type="number"
                      min={1}
                      max={90}
                      step={1}
                      aria-label="Mức giảm phần trăm"
                      value={form.value}
                      disabled={locked}
                      onChange={(e) => update({ value: e.target.value })}
                    />
                    <span className="input-group-text">%</span>
                  </div>
                )}
              </label>
            </div>
            {form.type === 'percent' && (
              <div className="col-6">
                <label className="form-label">
                  Giảm tối đa
                  <MoneyInput
                    label="Giảm tối đa"
                    value={form.maxDiscount}
                    disabled={locked}
                    onChange={(maxDiscount) => update({ maxDiscount })}
                  />
                </label>
              </div>
            )}
            <div className="col-6">
              <label className="form-label">
                Đơn tối thiểu
                <MoneyInput label="Đơn tối thiểu" value={form.minOrder} disabled={locked} onChange={(minOrder) => update({ minOrder })} />
              </label>
            </div>
            <div className="col-6">
              <label className="form-label">
                Số lượt dùng
                <input
                  className="form-control"
                  type="number"
                  min={Math.max(1, voucher?.usedCount ?? 0)}
                  step={1}
                  value={form.quantity}
                  onChange={(e) => update({ quantity: e.target.value })}
                />
              </label>
            </div>
            <div className="col-6">
              <label className="form-label">
                Bắt đầu
                <input
                  className="form-control"
                  type="date"
                  value={form.start}
                  disabled={locked}
                  onChange={(e) => update({ start: e.target.value })}
                />
              </label>
            </div>
            <div className="col-6">
              <label className="form-label">
                Kết thúc
                <input
                  className="form-control"
                  type="date"
                  min={form.start > today ? form.start : today}
                  max={form.start ? addDays(form.start, MAX_DAYS) : undefined}
                  value={form.end}
                  onChange={(e) => update({ end: e.target.value })}
                />
              </label>
            </div>
          </div>
          <small className="text-muted">
            Mỗi khách dùng 1 lần, chạy tối đa {MAX_DAYS} ngày. Áp cho đơn mua vật tư, tính trên tổng tiền hàng sau giá
            khuyến mãi.
          </small>
          <div>
            <div className="form-label mb-2">Khách sẽ thấy</div>
            <VoucherCard
              voucher={{ type: input.type, value: input.value || 0, maxDiscount: input.maxDiscount, minOrder: input.minOrder }}
              title={input.title || 'Tên voucher'}
              lines={[
                <>
                  <i className="ti ti-clock" aria-hidden="true" />
                  HSD {form.end ? vnDayMonth(saleEndIso(form.end)) : '—'} · Còn{' '}
                  {Math.max(0, (input.quantity || 0) - (voucher?.usedCount ?? 0))} lượt
                </>,
              ]}
              action={
                <span className="btn btn-sm btn-accent" aria-hidden="true">
                  Lưu
                </span>
              }
            />
          </div>
        </div>
        {error && <p className="text-danger mt-3 mb-0">{error}</p>}
        <div className="agrilink-drawer-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Đang lưu…' : voucher ? 'Lưu thay đổi' : 'Tạo voucher'}
          </button>
        </div>
      </section>
    </div>
  );
}
