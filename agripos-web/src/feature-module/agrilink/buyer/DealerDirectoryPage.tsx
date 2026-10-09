import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, PageHeader, Pagination, PillGroup, SkeletonState } from '../../../components/ui';
import { agrilinkBuyerApi, apiError } from '../../../services/agrilink.service';
import type { DealerCard, DealerCropTag } from '../../../services/agrilink.types';
import { matchingApi } from '../../../services/agrilink-matching.service';
import type { Province } from '../../../services/agrilink-matching.types';
import { DealerCover } from '../components/DealerCover';
import { cropImage } from '../../../assets/img/crops';
import { spotlight } from '../../../utils/motion';
import { fulfillmentLabels } from '../labels';
import { mergeCropTags } from './dealerDirectory';
import './dealerDirectory.css';
import VerifiedBadge from '../../../components/brand/VerifiedBadge';

const PAGE_SIZE = 9;

export default function DealerDirectoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const crop = searchParams.get('crop') || '';
  const province = searchParams.get('province') || '';
  // Nhu cầu của người dùng: mua vật tư (đại lý có hàng bán) hay bán nông sản (đại lý có tin thu mua).
  const mode = (searchParams.get('mode') || '') as '' | 'buy' | 'sell';
  const onlyDelivery = searchParams.get('delivery') === '1';
  const onlyVerified = searchParams.get('verified') === '1';
  // Chữ đang gõ giữ ở state riêng: ghi thẳng vào URL mỗi phím làm bộ gõ tiếng Việt (Telex/VNI) bị ngắt giữa chừng.
  const [text, setText] = useState(q);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [dealers, setDealers] = useState<DealerCard[]>([]);
  const [cropOptions, setCropOptions] = useState<DealerCropTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  type Filters = { q: string; crop: string; province: string; mode: string; delivery: string; verified: string };
  const setFilter = (next: Partial<Filters>) => {
    const merged: Filters = {
      q, crop, province, mode,
      delivery: onlyDelivery ? '1' : '',
      verified: onlyVerified ? '1' : '',
      ...next,
    };
    // Chọn nông sản nghĩa là đang muốn bán nông sản; về "Mua vật tư" thì bỏ lọc nông sản.
    if (next.crop) merged.mode = 'sell';
    if (next.mode === 'buy' || next.mode === '') merged.crop = next.crop ?? '';
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) if (value) params[key] = value;
    setSearchParams(params, { replace: true });
  };
  const clearFilters = () => {
    setText('');
    setSearchParams({}, { replace: true });
  };
  useEffect(() => {
    void matchingApi.provinces().then(setProvinces).catch(() => {});
    // Đủ danh sách nông sản đang được thu mua, kể cả khi mở trang với bộ lọc sẵn trên URL.
    void agrilinkBuyerApi.dealers().then((all) => setCropOptions((current) => mergeCropTags(current, all))).catch(() => {});
  }, []);
  // Đẩy từ khoá lên URL sau khi ngừng gõ 300ms.
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = window.setTimeout(() => setFilter({ q: text.trim() }), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      agrilinkBuyerApi
        .dealers(q, crop, province)
        .then((data) => {
          if (active) {
            setDealers(data);
            setCropOptions((current) => mergeCropTags(current, data));
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(apiError(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [q, crop, province]);
  const selectedCrop = cropOptions.find((tag) => tag.code === crop);
  const shown = dealers.filter(
    (d) =>
      (mode !== 'buy' || d.saleCount > 0) &&
      (mode !== 'sell' || d.buyCount > 0) &&
      (!onlyDelivery || d.fulfillmentOptions?.includes('delivery')) &&
      (!onlyVerified || d.verified),
  );
  const filtered = !!(q || crop || province || mode || onlyDelivery || onlyVerified);
  // Bộ lọc đổi thì setFilter bỏ tham số page → tự về trang 1.
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(searchParams.get('page')) || 1), pageCount);
  const pageDealers = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const goPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next > 1) params.set('page', String(next));
    else params.delete('page');
    setSearchParams(params);
    document.querySelector('.dealer-result-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const provinceName = provinces.find((p) => p.code === province)?.name;
  return (
    <>
      <PageHeader title="Khám phá đại lý" subtitle="Tìm vật tư và tin thu mua gần bạn" />
      <div className="card dealer-filter mb-4">
        <div className="dealer-search">
          <div className="dealer-search-input">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              className="form-control"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tìm tên đại lý, địa chỉ hoặc khu vực (có dấu hay không dấu đều được)"
              aria-label="Tìm đại lý"
            />
          </div>
          <div className="dealer-search-province">
            <i className="ti ti-map-pin" aria-hidden="true" />
            <select
              className="form-select"
              value={province}
              onChange={(e) => setFilter({ province: e.target.value })}
              aria-label="Lọc theo tỉnh / thành"
            >
              <option value="">Tất cả tỉnh / thành</option>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="dealer-filter-row">
          <span className="dealer-filter-label">Bạn cần</span>
          <PillGroup className="dealer-mode" role="group" aria-label="Nhu cầu" activeKey={mode}>
            {([
              ['', 'Tất cả', 'ti-layout-grid'],
              ['buy', 'Mua vật tư', 'ti-shopping-cart'],
              ['sell', 'Bán nông sản', 'ti-plant-2'],
            ] as const).map(([value, label, icon]) => (
              <button
                type="button"
                key={value || 'all'}
                className={mode === value ? 'active' : ''}
                aria-pressed={mode === value}
                onClick={() => setFilter({ mode: value })}
              >
                <i className={`ti ${icon}`} aria-hidden="true" />
                {label}
              </button>
            ))}
          </PillGroup>
          <span className="dealer-filter-divider" aria-hidden="true" />
          <span className="dealer-filter-label">Tiện ích</span>
          <button
            type="button"
            className={`dealer-toggle${onlyDelivery ? ' active' : ''}`}
            aria-pressed={onlyDelivery}
            onClick={() => setFilter({ delivery: onlyDelivery ? '' : '1' })}
          >
            <i className="ti ti-truck-delivery" aria-hidden="true" />
            Giao tận nơi
          </button>
          <button
            type="button"
            className={`dealer-toggle${onlyVerified ? ' active' : ''}`}
            aria-pressed={onlyVerified}
            onClick={() => setFilter({ verified: onlyVerified ? '' : '1' })}
          >
            <i className="ti ti-rosette-discount-check" aria-hidden="true" />
            Đã xác minh
          </button>
        </div>
        {(mode === 'sell' || crop) && (cropOptions.length > 0 || crop) && (
          <div className="dealer-filter-row">
            <span className="dealer-filter-label">Nông sản</span>
            <div className="dealer-crop-filter" role="group" aria-label="Lọc theo nông sản đại lý thu mua">
              <button
                type="button"
                className={`dealer-crop-chip${crop ? '' : ' active'}`}
                aria-pressed={!crop}
                onClick={() => setFilter({ crop: '', mode: 'sell' })}
              >
                Tất cả
              </button>
              {cropOptions.map((tag) => (
                <button
                  type="button"
                  key={tag.code}
                  className={`dealer-crop-chip${crop === tag.code ? ' active' : ''}`}
                  aria-pressed={crop === tag.code}
                  onClick={() => setFilter(crop === tag.code ? { crop: '', mode: 'sell' } : { crop: tag.code })}
                >
                  {cropImage(tag.code) && <img src={cropImage(tag.code)} alt="" />}
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {!loading && (
        <div className="dealer-result-bar">
          <span>
            Tìm thấy <strong>{shown.length}</strong> đại lý
            {provinceName && <> tại <strong>{provinceName}</strong></>}
            {selectedCrop && <> đang thu mua <strong>{selectedCrop.name}</strong></>}
          </span>
          {filtered && (
            <button type="button" className="btn btn-link btn-sm p-0" onClick={clearFilters}>
              <i className="ti ti-x me-1" aria-hidden="true" />
              Xoá bộ lọc
            </button>
          )}
        </div>
      )}
      {error && <p className="text-danger">{error}</p>}
      {loading && !dealers.length ? (
        <SkeletonState variant="cards" count={3} />
      ) : shown.length ? (
        <>
          <div className="row g-3 agri-reveal" key={page} onMouseMove={spotlight}>
          {pageDealers.map((dealer) => (
            <div className="col-12 col-md-6 col-xl-4" key={dealer.id}>
              <Link
                className="card h-100 p-0 overflow-hidden text-decoration-none text-reset agl-spot"
                to={`/agrilink/dai-ly/${dealer.id}`}
              >
                <DealerCover coverUrl={dealer.coverUrl} logoUrl={dealer.logoUrl} />
                <div className="card-body px-4 pb-4 pt-2">
                  <div className="mb-3">
                    <h5 className="mb-1">
                      {dealer.name}
                      {dealer.verified && <VerifiedBadge />}
                    </h5>
                    <small className="text-muted">{dealer.region}</small>
                  </div>
                  {dealer.crops && dealer.crops.length > 0 && (
                    <div className="dealer-crop-tags mb-3" aria-label="Nông sản đang thu mua">
                      <span className="dealer-crop-tags-label">
                        <i className="ti ti-plant-2" aria-hidden="true" />
                        Thu mua
                      </span>
                      {dealer.crops.map((tag) => (
                        <span key={tag.code} className={`dealer-crop-tag${tag.code === crop ? ' match' : ''}`}>
                          {cropImage(tag.code) && <img src={cropImage(tag.code)} alt="" />}
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-muted mb-2">{dealer.address}</p>
                  {dealer.openingHours?.trim() && (
                    <p className="mb-2">
                      <i className="ti ti-clock me-1" />
                      {dealer.openingHours}
                    </p>
                  )}
                  <div className="d-flex gap-1 flex-wrap mb-3">
                    {dealer.fulfillmentOptions?.map((option) => (
                      <span className="badge bg-light text-dark border" key={option}>
                        {fulfillmentLabels[option]}
                      </span>
                    ))}
                  </div>
                  <small className="text-muted">
                    {dealer.saleCount} vật tư · {dealer.buyCount} tin thu mua
                  </small>
                </div>
              </Link>
            </div>
          ))}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={shown.length} onChange={goPage} itemLabel="đại lý" />
        </>
      ) : (
        <EmptyState
          title="Chưa tìm thấy đại lý"
          description={
            selectedCrop
              ? `Chưa có đại lý nào đang thu mua ${selectedCrop.name}. Thử nông sản khác hoặc đăng nhu cầu bán.`
              : 'Thử từ khóa khác để tìm đại lý phù hợp.'
          }
        />
      )}
    </>
  );
}
