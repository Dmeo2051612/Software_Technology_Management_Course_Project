import { useState } from 'react';
import { Modal } from 'react-bootstrap';
import type { StorefrontVoucher } from '../../../services/agrilink.types';
import { fmtVND } from '../../../utils/formatters';
import VoucherCard from '../components/VoucherCard';
import { vnDayMonth, voucherBlocker, voucherDiscount } from '../voucher';

/** Hộp chọn voucher của một đại lý trong giỏ hàng. */
export default function VoucherPicker({
  dealerName,
  vouchers,
  subtotal,
  selectedId,
  onApply,
  onClose,
}: {
  dealerName: string;
  vouchers: StorefrontVoucher[];
  subtotal: number;
  selectedId: string | null;
  onApply: (id: string | null) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(selectedId);
  const now = new Date();
  const usable = vouchers.filter((v) => !voucherBlocker(v, subtotal, now));
  const blocked = vouchers.filter((v) => voucherBlocker(v, subtotal, now));
  return (
    <Modal show onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Chọn voucher — {dealerName}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-2">
        {usable.length > 0 && <div className="small fw-semibold text-muted text-uppercase">Dùng được cho đơn này</div>}
        <div role="radiogroup" aria-label="Voucher dùng được" className="d-grid gap-2">
          {usable.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={picked === v.id}
              className="btn p-0 border-0 text-start"
              onClick={() => setPicked(v.id)}
            >
              <VoucherCard
                voucher={v}
                title={v.title}
                selected={picked === v.id}
                lines={[
                  `HSD ${vnDayMonth(v.endsAt)}`,
                  <span className="is-good">Giảm {fmtVND(voucherDiscount(v, subtotal))} cho đơn này</span>,
                ]}
                action={<span className={`voucher-radio${picked === v.id ? ' is-on' : ''}`} aria-hidden="true" />}
              />
            </button>
          ))}
        </div>
        {blocked.length > 0 && <div className="small fw-semibold text-muted text-uppercase mt-2">Chưa dùng được</div>}
        {blocked.map((v) => (
          <VoucherCard
            key={v.id}
            voucher={v}
            title={v.title}
            dim
            lines={[
              <span className="is-warn">
                <i className="ti ti-info-circle" aria-hidden="true" /> {voucherBlocker(v, subtotal, now)}
              </span>,
            ]}
          />
        ))}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-outline-secondary" onClick={() => onApply(null)}>
          Không dùng voucher
        </button>
        <button type="button" className="btn btn-primary" disabled={!picked} onClick={() => onApply(picked)}>
          Áp dụng
        </button>
      </Modal.Footer>
    </Modal>
  );
}
