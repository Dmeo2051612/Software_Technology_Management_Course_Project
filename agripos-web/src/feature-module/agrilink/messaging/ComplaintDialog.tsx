import { useRef, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { apiError } from '../../../services/agrilink.service';
import { messagingApi, type ComplaintInput } from '../../../services/agrilink-messaging.service';
import type { OrderDetail } from '../../../services/agrilink.types';
import { COMPLAINT_CATEGORIES_BY_KIND, COMPLAINT_CATEGORY, COMPLAINT_WISH } from './messaging';
import { showToast } from '../../../stores/toastStore';

const MAX_PHOTOS = 4;
const MIN_BODY = 20;

/** Có thể khiếu nại đơn này không (khớp quy tắc phía máy chủ). */
export function canComplain(order: Pick<OrderDetail, 'status'>): boolean {
  return ['confirmed', 'delivering', 'completed', 'cancelled'].includes(order.status);
}

export default function ComplaintDialog({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState('');
  const [wish, setWish] = useState<ComplaintInput['wish']>();
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const categories = COMPLAINT_CATEGORIES_BY_KIND[order.kind];

  const submit = async () => {
    if (!category) return setError('Chọn vấn đề gặp phải.');
    if (body.trim().length < MIN_BODY) return setError(`Mô tả ít nhất ${MIN_BODY} ký tự để đại lý hiểu rõ.`);
    setBusy(true);
    setError('');
    try {
      const complaint = await messagingApi.complain(order.id, { category, body: body.trim(), ...(wish ? { wish } : {}) });
      // Ảnh được gửi kèm ngay sau khi có mã khiếu nại. Lỗi ảnh không chặn khiếu nại đã tạo:
      // vẫn mở trang khiếu nại để gửi lại ảnh ở đó.
      if (photos.length) {
        try {
          const urls: string[] = [];
          for (const file of photos) urls.push((await messagingApi.uploadImage(complaint.id, file)).url);
          await messagingApi.send(complaint.id, { body: 'Ảnh minh hoạ', images: urls });
        } catch {
          showToast('warning', 'Đã gửi khiếu nại nhưng chưa gửi được ảnh. Hãy gửi lại ảnh trong trang khiếu nại.');
        }
      }
      navigate(`/agrilink/khieu-nai/${complaint.id}`);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show onHide={onClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Khiếu nại đơn {order.code}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-3">
        <div className="alert alert-info mb-0">
          Khiếu nại được gửi đến <strong>{order.dealer?.name ?? 'đại lý'}</strong> trước. Nếu sau 3 ngày chưa được giải
          quyết hoặc bạn không đồng ý, bạn có thể chuyển lên AgriLink xem xét.
        </div>
        <div>
          <div className="form-label">Vấn đề gặp phải</div>
          <div className="choice-chips" role="group" aria-label="Vấn đề gặp phải">
            {categories.map((key) => (
              <button key={key} type="button" className={category === key ? 'active' : ''} aria-pressed={category === key} onClick={() => setCategory(key)}>
                {COMPLAINT_CATEGORY[key]}
              </button>
            ))}
          </div>
        </div>
        <label className="form-label mb-0">
          Mô tả chi tiết
          <textarea
            className="form-control mt-1"
            rows={4}
            maxLength={2000}
            value={body}
            placeholder="Ví dụ: 1 bao bị rách, phân vón cục, không dùng được…"
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <div>
          <div className="form-label">
            Ảnh (tối đa {MAX_PHOTOS}) {photos.length > 0 && <small className="text-muted">— đã chọn {photos.length}</small>}
          </div>
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={photos.length >= MAX_PHOTOS} onClick={() => fileRef.current?.click()}>
            <i className="ti ti-photo-plus me-1" />
            Chọn ảnh
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Chọn ảnh khiếu nại"
            onChange={(e) => setPhotos((p) => [...p, ...Array.from(e.target.files ?? [])].slice(0, MAX_PHOTOS))}
          />
        </div>
        <div>
          <div className="form-label">Bạn mong muốn</div>
          <div className="choice-chips" role="group" aria-label="Mong muốn">
            {Object.entries(COMPLAINT_WISH).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={wish === key ? 'active' : ''}
                aria-pressed={wish === key}
                onClick={() => setWish(wish === key ? undefined : (key as ComplaintInput['wish']))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p className="text-danger mb-0" role="alert">
            {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
          Huỷ
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Đang gửi…' : 'Gửi khiếu nại'}
        </button>
      </Modal.Footer>
    </Modal>
  );
}
