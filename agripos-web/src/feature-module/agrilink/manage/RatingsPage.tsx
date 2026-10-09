import { useEffect, useState } from 'react';
import { EmptyState, PageHeader, SkeletonState } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { DealerRating, RatingAggregates } from '../../../services/agrilink.types';
import { fmtDate } from '../../../utils/formatters';
import './dealerPages.css';

const tagLabels: Record<string, string> = {
  accurateWeight: 'Cân đúng', paidOnTime: 'Trả tiền đúng hẹn',
  onTime: 'Đúng giờ hẹn', asDescribed: 'Hàng đúng mô tả',
};
function RatingCard({ rating }: { rating: DealerRating }) {
  return <article className="border-bottom py-3">
    <div className="d-flex justify-content-between align-items-center">
      <strong aria-label={`${rating.stars} trên 5 sao`}>
        {Array.from({ length: 5 }, (_, index) => <i key={index} className={`ti ${index < rating.stars ? 'ti-star-filled text-warning' : 'ti-star text-muted'}`} aria-hidden="true" />)}
      </strong>
      <small className="text-muted">{fmtDate(rating.createdAt)}</small>
    </div>
    <div className="d-flex flex-wrap gap-2 my-2">{Object.entries(rating.tags).filter(([, value]) => value === true).map(([key]) => <span className="badge bg-success" key={key}>{tagLabels[key]}</span>)}{rating.hidden && <span className="badge bg-secondary">Đã ẩn</span>}</div>
    {rating.comment && <p className="mb-1">{rating.comment}</p>}
    {rating.hiddenReason && <small className="text-muted">Lý do ẩn: {rating.hiddenReason}</small>}
  </article>;
}
export default function RatingsPage() {
  const [items, setItems] = useState<DealerRating[] | null>(null);
  const [aggregates, setAggregates] = useState<RatingAggregates | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    void agrilinkManageApi.ratings(page).then((result) => { setItems(result.items); setAggregates(result.aggregates); setError(''); }).catch((e) => setError(apiError(e)));
  }, [page]);
  const bars = [
    ['Cân đúng', aggregates?.accurateWeightPct],
    ['Trả tiền đúng hẹn', aggregates?.paidOnTimePct],
    ['Đúng giờ hẹn', aggregates?.onTimePct],
    ['Hàng đúng mô tả', aggregates?.asDescribedPct],
  ] as const;
  return <>
    <PageHeader title="Đánh giá" subtitle="Ý kiến từ các đơn AgriLink đã hoàn thành." />
    {error && <p className="text-danger">{error}</p>}
    {!items ? <SkeletonState variant="cards" count={2} /> : <>
      <div className="row g-3 mb-4">
        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-body p-4">
              <div className="display-5 fw-bold text-primary">{aggregates?.avgStars?.toFixed(1).replace('.', ',') || '—'}</div>
            <div aria-label="Thang đánh giá 5 sao">{Array.from({ length: 5 }, (_, index) => <i className="ti ti-star-filled text-warning" key={index} aria-hidden="true" />)}</div>
              <p className="text-muted mb-0">{aggregates?.count || 0} đánh giá</p>
            </div>
          </div>
        </div>
        <div className="col-lg-8">
          <div className="card h-100">
            <div className="card-body p-4">{bars.map(([label, value]) => <div className="d-flex align-items-center gap-3 mb-2" key={label}>
              <span className="agrilink-rating-label">{label}</span>
              <div className="progress flex-grow-1" role="progressbar" aria-label={label} aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress-bar" style={{ width: `${value ?? 0}%` }} />
              </div>
              <strong>{value == null ? '—' : `${Math.round(value)}%`}</strong>
            </div>)}</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-body p-4">
          <h2 className="h5 mb-3">Đánh giá gần đây</h2>{items.length ? items.map((rating) => <RatingCard key={rating.id} rating={rating} />) : <EmptyState title="Chưa có đánh giá" />}
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn btn-outline-primary btn-sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Trang trước</button>
            <button className="btn btn-outline-primary btn-sm" disabled={items.length < 20} onClick={() => setPage((value) => value + 1)}>Trang sau</button>
          </div>
        </div>
      </div>
    </>}
  </>;
}
