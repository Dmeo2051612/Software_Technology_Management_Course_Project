import { useState } from 'react';
import { agrilinkBuyerApi, apiError } from '../../../services/agrilink.service';
import type { StorefrontVoucher } from '../../../services/agrilink.types';
import { showToast } from '../../../stores/toastStore';
import VoucherCard from '../components/VoucherCard';
import { vnDayMonth } from '../voucher';

/** Dải "Voucher của đại lý" trên gian hàng: nông dân lưu để dùng khi đặt hàng. */
export default function VoucherStrip({
  vouchers,
  canSave,
  onSaved,
}: {
  vouchers: StorefrontVoucher[];
  /** false với nhân viên của chính đại lý này. */
  canSave: boolean;
  onSaved: (id: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const save = async (v: StorefrontVoucher) => {
    setBusy(v.id);
    try {
      await agrilinkBuyerApi.saveVoucher(v.id);
      onSaved(v.id);
      showToast('success', 'Đã lưu voucher — chọn khi đặt hàng trong giỏ');
    } catch (e) {
      showToast('error', apiError(e));
    } finally {
      setBusy('');
    }
  };
  const now = new Date();
  return (
    <section className="mb-4" aria-label="Voucher của đại lý">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <h5 className="mb-0 d-flex align-items-center gap-2">
          <i className="ti ti-ticket text-accent" aria-hidden="true" />
          Voucher của đại lý
        </h5>
        <small className="text-muted">Lưu lại để dùng khi đặt hàng</small>
      </div>
      <div className="voucher-strip">
        {vouchers.map((v) => {
          const upcoming = new Date(v.startsAt) > now;
          const soldOut = v.remaining <= 0;
          const action = v.usedByMe ? (
            <span className="btn btn-sm btn-light disabled">Đã dùng</span>
          ) : v.saved ? (
            <span className="btn btn-sm btn-accent-soft disabled">
              <i className="ti ti-check me-1" aria-hidden="true" />
              Đã lưu
            </span>
          ) : canSave && !soldOut ? (
            <button type="button" className="btn btn-sm btn-accent" disabled={busy === v.id} onClick={() => void save(v)}>
              Lưu
            </button>
          ) : null;
          return (
            <VoucherCard
              key={v.id}
              voucher={v}
              title={v.title}
              dim={v.usedByMe || soldOut}
              badge={upcoming ? <span className="badge bg-primary-subtle text-primary-emphasis">Sắp diễn ra</span> : undefined}
              lines={[
                <>
                  <i className="ti ti-clock" aria-hidden="true" />
                  {upcoming
                    ? `Dùng từ ${vnDayMonth(v.startsAt)}`
                    : soldOut
                      ? 'Đã hết lượt'
                      : `HSD ${vnDayMonth(v.endsAt)} · Còn ${v.remaining} lượt`}
                </>,
              ]}
              action={action}
            />
          );
        })}
      </div>
    </section>
  );
}
