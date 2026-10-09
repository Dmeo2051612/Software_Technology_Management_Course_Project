import { useEffect, useState } from 'react';
import { EmptyState, MoneyText, PageHeader, SkeletonState } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { ProductListing } from '../../../services/agrilink.types';
import { showToast } from '../../../stores/toastStore';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import { discountPercent, saleEndLabel } from '../listing';
import ProductListingDrawer from './ProductListingDrawer';
import './dealerPages.css';

type Filter = 'all' | 'published' | 'hidden';

function ProductRow({
  row,
  saving,
  onToggle,
  onEdit,
}: {
  row: ProductListing;
  saving: boolean;
  onToggle: (published: boolean) => void;
  onEdit: () => void;
}) {
  const cover = row.images?.[0] ?? row.imageUrl;
  const displayName = row.title?.trim() || row.name;
  const displayUnit = row.listingUnit?.trim() || row.unit;
  const basePrice = row.agrilinkPrice ?? row.sellingPrice;
  const effective = row.effectivePrice ?? basePrice;
  return (
    <tr>
      <td>
        <div className="listing-product">
          {cover ? (
            <img src={normalizeImageUrl(cover) || ''} alt="" />
          ) : (
            <span className="listing-thumb-empty">
              <i className="ti ti-photo" />
            </span>
          )}
          <div>
            <strong>{displayName}</strong>
            <small>
              {displayUnit}
              {displayName !== row.name ? ` · AgriPOS: ${row.name}` : ''}
            </small>
          </div>
        </div>
      </td>
      <td className="listing-price">
        <MoneyText value={effective} bold />
        {row.saleActive && (
          <>
            <del>
              <MoneyText value={basePrice} />
            </del>{' '}
            <span className="badge bg-danger">-{discountPercent(basePrice, effective)}%</span>
            {row.saleEndsAt && <small>{saleEndLabel(row.saleEndsAt)}</small>}
          </>
        )}
        {row.agrilinkPrice == null && !row.saleActive && <small className="text-muted">Theo giá AgriPOS</small>}
      </td>
      <td>
        <span className={`badge ${row.inStock ? 'bg-success' : 'bg-light text-dark border'}`}>
          {row.inStock ? `Còn ${row.stockQuantity}` : 'Hết hàng'}
        </span>
      </td>
      <td>
        <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            checked={row.published}
            disabled={saving}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label={`Đăng bán ${displayName}`}
          />
        </div>
      </td>
      <td className="text-end">
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={onEdit}>
          Sửa
        </button>
      </td>
    </tr>
  );
}

export default function ProductsPage() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProductListing[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [editing, setEditing] = useState<ProductListing | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    let active = true;
    agrilinkManageApi
      .products({
        q: debounced,
        ...(filter === 'all' ? {} : { published: filter === 'published' }),
        page,
        limit: 50,
      })
      .then((data) => {
        if (!active) return;
        setRows(data.items);
        setTotal(data.total);
        setError('');
      })
      .catch((e) => {
        if (active) setError(apiError(e));
      });
    return () => {
      active = false;
    };
  }, [debounced, filter, page]);

  const replaceRow = (updated: ProductListing) =>
    setRows((s) => s?.map((x) => (x.productId === updated.productId ? updated : x)) || null);

  const toggle = async (row: ProductListing, published: boolean) => {
    if (saving) return;
    setSaving(row.productId);
    replaceRow({ ...row, published });
    try {
      // Chỉ gửi trạng thái đăng bán; các thông tin khác được giữ nguyên.
      replaceRow(await agrilinkManageApi.setProduct(row.productId, { published }));
      showToast('success', published ? 'Đã đăng bán sản phẩm' : 'Đã ngừng đăng bán');
    } catch (e) {
      replaceRow(row);
      showToast('error', apiError(e));
    } finally {
      setSaving('');
    }
  };

  return (
    <>
      <PageHeader
        title="Sản phẩm đăng bán"
        subtitle="Chọn vật tư hiển thị trên AgriLink, sửa tên, ảnh, mô tả và giá khuyến mãi"
      />
      <div className="d-flex gap-2 mb-3">
        <input
          className="form-control flex-grow-1"
          placeholder="Tìm sản phẩm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Tìm sản phẩm"
        />
        <select
          className="form-select w-auto"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setPage(1);
          }}
          aria-label="Lọc đăng bán"
        >
          <option value="all">Tất cả</option>
          <option value="published">Đang đăng</option>
          <option value="hidden">Chưa đăng</option>
        </select>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {!rows ? (
        <SkeletonState variant="table" rows={5} />
      ) : rows.length ? (
        <div className="card">
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>Giá online</th>
                  <th>Tồn AgriPOS</th>
                  <th>Đăng bán</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ProductRow
                    key={row.productId}
                    row={row}
                    saving={saving === row.productId}
                    onToggle={(published) => void toggle(row, published)}
                    onEdit={() => setEditing(row)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState title="Chưa có sản phẩm" />
      )}
      {total > 50 && (
        <div className="d-flex justify-content-end align-items-center gap-2 mt-3">
          <button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Trước
          </button>
          <span>
            Trang {page} / {Math.ceil(total / 50)}
          </span>
          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={page >= Math.ceil(total / 50)}
            onClick={() => setPage(page + 1)}
          >
            Sau
          </button>
        </div>
      )}
      {editing && (
        <ProductListingDrawer
          key={editing.productId}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            replaceRow(updated);
            setEditing(null);
            showToast('success', 'Đã lưu sản phẩm');
          }}
        />
      )}
    </>
  );
}
