import type { ReactNode } from 'react';
import type { VoucherRule } from '../../../services/agrilink.types';
import { voucherCondition, voucherStub } from '../voucher';
import './voucher.css';

/** Thẻ voucher dạng vé: cuống mức giảm bên trái, điều kiện bên phải. */
export default function VoucherCard({
  voucher,
  title,
  lines = [],
  action,
  dim = false,
  selected = false,
  badge,
}: {
  voucher: VoucherRule;
  title: string;
  /** Các dòng phụ dưới điều kiện đơn tối thiểu (hạn dùng, số lượt, lý do…). */
  lines?: ReactNode[];
  action?: ReactNode;
  dim?: boolean;
  selected?: boolean;
  badge?: ReactNode;
}) {
  const stub = voucherStub(voucher);
  return (
    <div className={`voucher-card${dim ? ' is-dim' : ''}${selected ? ' is-selected' : ''}`}>
      <div className="voucher-stub" aria-hidden="true">
        <strong>{stub.big}</strong>
        <small>{stub.small}</small>
      </div>
      <div className="voucher-body">
        <strong className="voucher-title">
          {title} {badge}
        </strong>
        <span className="voucher-line">{voucherCondition(voucher)}</span>
        {lines.map((line, i) => (
          <span className="voucher-line" key={i}>
            {line}
          </span>
        ))}
      </div>
      {action && <div className="voucher-action">{action}</div>}
    </div>
  );
}
