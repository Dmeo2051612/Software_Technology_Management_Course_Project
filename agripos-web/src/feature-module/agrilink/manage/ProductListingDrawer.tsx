import { useRef, useState } from 'react';
import { MoneyText } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { ProductListing, ProductListingInput } from '../../../services/agrilink.types';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import { toLocalDateString } from '../../../utils/formatters';
import { discountPercent, saleEndDateInput, saleEndIso } from '../listing';
import { validPrice } from '../validation';

const MAX_IMAGES = 6;

interface Form {
  title: string;
  unit: string;
  description: string;
  images: string[];
  price: string;
  saleOn: boolean;
  salePrice: string;
  saleEnd: string;
  published: boolean;
}

function initialForm(row: ProductListing): Form {
  const hasSale = row.salePrice != null && !!row.saleEndsAt;
  return {
    title: row.title ?? '',
    unit: row.listingUnit ?? '',
    description: row.description ?? '',
    images: row.images ?? [],
    price: row.agrilinkPrice == null ? '' : String(row.agrilinkPrice),
    saleOn: hasSale,
    salePrice: hasSale ? String(row.salePrice) : '',
    saleEnd: hasSale ? saleEndDateInput(row.saleEndsAt!) : '',
    published: row.published,
  };
}

/** Kiểm tra form; trả về câu báo lỗi hoặc null. */
function formError(form: Form, basePrice: number): string | null {
  const price = form.price.trim() === '' ? null : Number(form.price);
  if (price != null && !validPrice(price)) return 'Giá bán online phải là số hợp lệ.';
  if (!form.saleOn) return null;
  const sale = Number(form.salePrice);
  if (form.salePrice.trim() === '' || !validPrice(sale)) return 'Nhập giá khuyến mãi hợp lệ.';
  if (sale >= basePrice) return 'Giá khuyến mãi phải thấp hơn giá bán.';
  if (!form.saleEnd) return 'Chọn ngày kết thúc khuyến mãi.';
  return null;
}

export default function ProductListingDrawer({
  row,
  onClose,
  onSaved,
}: {
  row: ProductListing;
  onClose: () => void;
  onSaved: (updated: ProductListing) => void;
}) {
  const [form, setForm] = useState<Form>(() => initialForm(row));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const basePrice = form.price.trim() === '' ? row.sellingPrice : Number(form.price);
  const salePrice = Number(form.salePrice);
  const percent = form.saleOn && form.salePrice ? discountPercent(basePrice, salePrice) : 0;
  const today = toLocalDateString(new Date());

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_IMAGES - form.images.length;
    if (room <= 0) {
      setError(`Tối đa ${MAX_IMAGES} ảnh.`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const { url } = await agrilinkManageApi.uploadListingImage(row.productId, file);
        setForm((f) => ({ ...f, images: [...f.images, url].slice(0, MAX_IMAGES) }));
      }
    } catch (e) {
      setError(apiError(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const moveToCover = (index: number) =>
    setForm((f) => ({ ...f, images: [f.images[index], ...f.images.filter((_, i) => i !== index)] }));

  const save = async () => {
    const problem = formError(form, basePrice);
    if (problem) {
      setError(problem);
      return;
    }
    const input: ProductListingInput = {
      published: form.published,
      price: form.price.trim() === '' ? null : Number(form.price),
      title: form.title.trim(),
      unit: form.unit.trim(),
      description: form.description.trim(),
      images: form.images,
      salePrice: form.saleOn ? salePrice : null,
      ...(form.saleOn ? { saleEndsAt: saleEndIso(form.saleEnd) } : {}),
    };
    setBusy(true);
    setError('');
    try {
      onSaved(await agrilinkManageApi.setProduct(row.productId, input));
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agrilink-drawer-backdrop" onMouseDown={onClose}>
      <section
        className="agrilink-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Sửa sản phẩm"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
          <div>
            <h5 className="mb-1">Sửa sản phẩm</h5>
            <small className="text-muted">
              AgriPOS: {row.name} · {row.unit} · <MoneyText value={row.sellingPrice} /> ·{' '}
              {row.inStock ? `còn ${row.stockQuantity}` : 'hết hàng'}
            </small>
          </div>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
            Đóng
          </button>
        </div>
        <p className="listing-note">
          Thông tin dưới đây chỉ hiển thị trên AgriLink, không thay đổi sản phẩm trong AgriPOS. Tồn kho vẫn lấy từ
          AgriPOS.
        </p>

        <div className="agrilink-drawer-fields">
          <label className="form-label">
            Tên hiển thị
            <input
              className="form-control"
              maxLength={180}
              placeholder={row.name}
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label className="form-label">
            Quy cách
            <input
              className="form-control"
              maxLength={50}
              placeholder={row.unit || 'VD: Bao 50kg'}
              value={form.unit}
              onChange={(e) => update({ unit: e.target.value })}
            />
          </label>
          <label className="form-label">
            Mô tả
            <textarea
              className="form-control"
              rows={4}
              maxLength={2000}
              placeholder="Thành phần, công dụng, cách dùng…"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
            />
            <small className="text-muted d-block text-end">{form.description.length}/2000</small>
          </label>

          <div>
            <span className="form-label">
              Ảnh ({form.images.length}/{MAX_IMAGES}) — ảnh đầu tiên là ảnh bìa
            </span>
            <div className="listing-images">
              {form.images.map((url, index) => (
                <figure key={url} className={`listing-image${index === 0 ? ' cover' : ''}`}>
                  <img src={normalizeImageUrl(url) || ''} alt={`Ảnh ${index + 1}`} />
                  <figcaption>
                    {index === 0 ? (
                      <span>Ảnh bìa</span>
                    ) : (
                      <button type="button" onClick={() => moveToCover(index)}>
                        Đặt làm bìa
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Xoá ảnh ${index + 1}`}
                      onClick={() => update({ images: form.images.filter((_, i) => i !== index) })}
                    >
                      <i className="ti ti-trash" />
                    </button>
                  </figcaption>
                </figure>
              ))}
              {form.images.length < MAX_IMAGES && (
                <button
                  type="button"
                  className="listing-image-add"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <i className="ti ti-photo-plus" />
                  {uploading ? 'Đang tải…' : 'Thêm ảnh'}
                </button>
              )}
            </div>
            {form.images.length === 0 && row.imageUrl && (
              <small className="text-muted">Chưa có ảnh riêng — đang dùng ảnh sản phẩm AgriPOS.</small>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="visually-hidden"
              tabIndex={-1}
              aria-label="Chọn ảnh sản phẩm"
              onChange={(e) => void addImages(e.target.files)}
            />
          </div>

          <label className="form-label">
            Giá bán online (đ)
            <input
              className="form-control"
              type="number"
              min="0"
              step="1"
              placeholder={`Theo giá AgriPOS: ${row.sellingPrice.toLocaleString('vi-VN')}`}
              value={form.price}
              onChange={(e) => update({ price: e.target.value })}
            />
          </label>

          <div className="listing-sale">
            <div className="form-check form-switch">
              <input
                id="listing-sale-on"
                className="form-check-input"
                type="checkbox"
                checked={form.saleOn}
                onChange={(e) => update({ saleOn: e.target.checked })}
              />
              <label className="form-check-label" htmlFor="listing-sale-on">
                Khuyến mãi có thời hạn
              </label>
            </div>
            {form.saleOn && (
              <div className="listing-sale-fields">
                <label className="form-label">
                  Giá khuyến mãi (đ)
                  <input
                    className="form-control"
                    type="number"
                    min="0"
                    step="1"
                    value={form.salePrice}
                    onChange={(e) => update({ salePrice: e.target.value })}
                  />
                </label>
                <label className="form-label">
                  Kết thúc ngày
                  <input
                    className="form-control"
                    type="date"
                    min={today}
                    value={form.saleEnd}
                    onChange={(e) => update({ saleEnd: e.target.value })}
                  />
                </label>
                {percent > 0 && <span className="badge bg-danger align-self-end mb-2">-{percent}%</span>}
              </div>
            )}
          </div>

          <div className="form-check form-switch">
            <input
              id="listing-published"
              className="form-check-input"
              type="checkbox"
              checked={form.published}
              onChange={(e) => update({ published: e.target.checked })}
            />
            <label className="form-check-label" htmlFor="listing-published">
              Đăng bán trên AgriLink
            </label>
          </div>
        </div>

        {error && (
          <p className="text-danger mt-3 mb-0" role="alert">
            {error}
          </p>
        )}
        <div className="agrilink-drawer-actions">
          <button type="button" className="btn btn-primary" disabled={busy || uploading} onClick={() => void save()}>
            {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
        </div>
      </section>
    </div>
  );
}
