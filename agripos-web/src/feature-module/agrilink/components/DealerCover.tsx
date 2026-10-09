import type { ReactNode } from 'react';
import { normalizeImageUrl } from '../../../utils/imageUrl';
import './dealerCover.css';

interface DealerCoverProps {
  coverUrl?: string | null;
  logoUrl?: string | null;
  /** card: thẻ trong danh sách đại lý · hero: đầu trang gian hàng / hồ sơ. */
  variant?: 'card' | 'hero';
  /** Nút thao tác đặt trên ảnh bìa (ví dụ "Đổi ảnh bìa"). */
  children?: ReactNode;
}

/** Ảnh bìa đại lý với logo tròn đè ở mép dưới; chưa có ảnh thì dùng nền xanh nhạt. */
export function DealerCover({ coverUrl, logoUrl, variant = 'card', children }: DealerCoverProps) {
  const cover = coverUrl ? normalizeImageUrl(coverUrl) : null;
  const logo = logoUrl ? normalizeImageUrl(logoUrl) : null;
  return (
    <div className={`dealer-cover dealer-cover-${variant}`}>
      <div className="dealer-cover-banner">
        {cover && <img src={cover} alt="" loading="lazy" />}
        {children}
      </div>
      <span className="dealer-cover-logo">
        {logo ? <img src={logo} alt="" loading="lazy" /> : <i className="ti ti-building-store" aria-hidden="true" />}
      </span>
    </div>
  );
}
