import { useState } from 'react';
import { Modal } from 'react-bootstrap';
import './cancelOrderDialog.css';

const QUICK_REASONS = [
  'Đặt nhầm sản phẩm / số lượng',
  'Muốn đổi địa chỉ hoặc hình thức nhận hàng',
  'Tìm được nơi bán giá tốt hơn',
  'Không còn nhu cầu',
  'Đại lý xác nhận quá lâu',
];

/** Hộp thoại huỷ đơn của người mua: chọn nhanh lý do hoặc tự nhập, xác nhận một lần. */
export default function CancelOrderDialog({
  code,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  code: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [picked, setPicked] = useState('');
  const [note, setNote] = useState('');
  const reason = [picked, note.trim()].filter(Boolean).join('. ');
  return (
    <Modal show onHide={busy ? undefined : onClose} centered>
      <Modal.Header closeButton={!busy}>
        <Modal.Title>Huỷ đơn {code}?</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted mb-3">
          Đại lý sẽ nhận được thông báo huỷ. Đơn đã huỷ không thể khôi phục, bạn có thể đặt lại đơn mới bất cứ lúc nào.
        </p>
        <span className="form-label d-block">Lý do huỷ</span>
        <div className="cancel-reasons mb-3" role="radiogroup" aria-label="Lý do huỷ">
          {QUICK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={picked === r}
              className={`cancel-reason${picked === r ? ' active' : ''}`}
              onClick={() => setPicked(picked === r ? '' : r)}
            >
              {r}
            </button>
          ))}
        </div>
        <label className="form-label" htmlFor="cancel-note">
          Ghi chú thêm cho đại lý (không bắt buộc)
        </label>
        <textarea
          id="cancel-note"
          className="form-control"
          rows={3}
          maxLength={400}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="VD: Tôi sẽ đặt lại với số lượng 5 bao."
        />
        {error && <p className="text-danger mt-2 mb-0">{error}</p>}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onClose}>
          Giữ đơn
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onConfirm(reason)}>
          {busy ? 'Đang huỷ…' : 'Huỷ đơn'}
        </button>
      </Modal.Footer>
    </Modal>
  );
}
