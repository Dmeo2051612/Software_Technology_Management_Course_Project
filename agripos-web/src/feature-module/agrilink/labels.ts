import type {
  CommodityType,
  Fulfillment,
  OrderKind,
  OrderStatus,
} from '../../services/agrilink.types';
export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  delivering: 'Đang giao',
  completed: 'Hoàn thành',
  rejected: 'Đã từ chối',
  cancelled: 'Đã huỷ',
};
export const statusBadges: Record<OrderStatus, string> = {
  pending: 'bg-warning text-dark',
  confirmed: 'bg-primary',
  delivering: 'bg-info text-dark',
  completed: 'bg-success',
  rejected: 'bg-danger',
  cancelled: 'agrilink-status-cancelled',
};
export function fulfillmentLabel(side: OrderKind, fulfillment: Fulfillment): string {
  if (side === 'sell') {
    return fulfillment === 'delivery' || fulfillment === 'pickup'
      ? 'Đại lý đến lấy tại vườn'
      : 'Nông dân mang đến đại lý';
  }
  return fulfillment === 'delivery' ? 'Đại lý giao tận nơi' : 'Tự đến đại lý lấy';
}
export const kindLabels: Record<OrderKind, string> = { buy: 'Mua vật tư', sell: 'Bán nông sản' };
export const fulfillmentLabels: Record<Fulfillment, string> = {
  pickup: 'Nhận tại cửa hàng',
  delivery: 'Giao tận nơi',
  at_dealer: 'Mang đến đại lý',
};
export const commodityLabels: Record<CommodityType, string> = {
  coffee_fresh: 'Cà phê tươi',
  coffee_bean: 'Cà phê nhân',
  pepper: 'Tiêu',
};
