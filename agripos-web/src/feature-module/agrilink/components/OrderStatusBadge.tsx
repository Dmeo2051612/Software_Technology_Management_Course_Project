import type { OrderStatus } from '../../../services/agrilink.types';
import { statusBadges, statusLabels } from '../labels';
/** Mỗi trạng thái một màu (agrilink-gray.css mục 21) để quét bảng đơn nhanh. */
export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${statusBadges[status]} agl-status agl-status-${status}`}>{statusLabels[status]}</span>;
}
