export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'delivering'
  | 'completed'
  | 'rejected'
  | 'cancelled';
export type OrderKind = 'buy' | 'sell';
export type Fulfillment = 'pickup' | 'delivery' | 'at_dealer';
export type CommodityType = 'coffee_fresh' | 'coffee_bean' | 'pepper';
export interface DealerCard {
  verified?: boolean;
  ratings?: { avgStars: number | null; count: number };
  id: string;
  name: string;
  region: string;
  address: string;
  phone: string;
  logoUrl: string | null;
  /** Ảnh bìa gian hàng ('' khi chưa có). */
  coverUrl?: string | null;
  openingHours: string;
  fulfillmentOptions: Fulfillment[];
  saleCount: number;
  buyCount: number;
  /** Nông sản đại lý đang thu mua (từ tin thu mua còn mới giá). */
  crops?: DealerCropTag[];
}
export interface DealerCropTag {
  code: string;
  name: string;
}
export interface Storefront {
  dealer: DealerCard & { bio: string };
  saleOffers: SaleOffer[];
  buyOffers: BuyOfferPublic[];
  /** Voucher đang chạy hoặc sắp chạy (7 ngày) — có ở API từ đợt D. */
  vouchers?: StorefrontVoucher[];
}
export type VoucherType = 'amount' | 'percent';
export type VoucherState = 'scheduled' | 'running' | 'ended' | 'exhausted' | 'stopped';
/** Phần quy tắc tính giảm của một voucher. */
export interface VoucherRule {
  type: VoucherType;
  value: number;
  maxDiscount: number | null;
  minOrder: number;
}
export interface StorefrontVoucher extends VoucherRule {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  remaining: number;
  saved: boolean;
  usedByMe: boolean;
}
export interface ManagedVoucher extends VoucherRule {
  id: string;
  title: string;
  quantity: number;
  usedCount: number;
  savedCount: number;
  /** Đã gắn với đơn nào (kể cả đơn huỷ) — khi đó không xoá được. */
  hasOrders: boolean;
  startsAt: string;
  endsAt: string;
  active: boolean;
  state: VoucherState;
}
export interface VouchersPageData {
  items: ManagedVoucher[];
  stats: { running: number; used30d: number; discount30d: number };
}
/** Dữ liệu tạo/sửa voucher; khi sửa chỉ gửi trường thay đổi. */
export interface VoucherInput {
  title?: string;
  type?: VoucherType;
  value?: number;
  maxDiscount?: number | null;
  minOrder?: number;
  quantity?: number;
  startsAt?: string;
  endsAt?: string;
  active?: boolean;
}
export interface SaleOffer {
  offerId: string;
  productId: string;
  name: string;
  unit: string;
  price: number;
  imageUrl: string | null;
  inStock: boolean;
  /** Giá gốc, chỉ có khi đang khuyến mãi. */
  originalPrice?: number;
  saleEndsAt?: string;
  description?: string;
  images?: string[];
}
export interface BuyOfferPublic {
  offerId: string;
  title: string;
  /** Mã và tên nông sản (agri_crops) — dùng để hiện ảnh nông sản. */
  cropCode?: string | null;
  cropName?: string | null;
  commodityType: CommodityType | null;
  unit: string;
  price: number;
  updatedAt: string;
}
export interface OrderItem {
  id: string;
  offerId: string;
  productId: string | null;
  commodityType: CommodityType | null;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  finalQuantity: number | null;
  finalUnitPrice: number | null;
}
export interface OrderEvent {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorName: string;
  note: string;
  createdAt: string;
}
export interface OrderSummary {
  id: string;
  code: string;
  kind: OrderKind;
  status: OrderStatus;
  fulfillment: Fulfillment;
  contactName: string;
  contactPhone: string;
  itemCount: number;
  estimatedTotal: number;
  finalTotal: number | null;
  /** Tiền giảm từ voucher (0 nếu không dùng). */
  discountAmount?: number;
  voucherTitle?: string | null;
  createdAt: string;
  dealer?: { id: string; name: string };
}
export interface OrderDetail extends OrderSummary {
  canRate?: boolean;
  rating?: { stars: number; accurateWeight: boolean | null; paidOnTime: boolean | null; onTime: boolean | null; asDescribed: boolean | null; comment: string; createdAt: string } | null;
  address: string;
  note: string;
  rejectReason: string | null;
  cancelReason: string | null;
  items: OrderItem[];
  events: OrderEvent[];
  posRef: { type: 'order' | 'weighing_slip'; id: string; code: string; status: string } | null;
  /** Quy tắc voucher của đơn (chỉ có ở chi tiết phía đại lý). */
  voucherRule?: Omit<VoucherRule, 'minOrder'> | null;
}
export interface PlaceOrderInput {
  kind: OrderKind;
  items: { offerId: string; quantity: number }[];
  fulfillment: Fulfillment;
  address?: string;
  note?: string;
  contactName: string;
  contactPhone: string;
  voucherId?: string;
}
export interface Party {
  id: string;
  name: string;
  phone: string | null;
}
export type CompleteInput =
  | {
      party: { customerId: string } | { createNew: true };
      items: { itemId: string; quantity: number; unitPrice: number }[];
      paymentMethod: 'cash' | 'transfer' | 'debt';
      paidAmount: number;
    }
  | {
      party: { farmerId: string } | { createNew: true };
      weights: number[];
      pricePerKg: number;
      paidAmount: number;
      weighDate: string;
    };
export interface DealerProfile {
  name: string;
  bio: string;
  region: string;
  address: string;
  phone: string;
  logoUrl: string | null;
  coverUrl?: string | null;
  openingHours: string;
  fulfillmentOptions: Fulfillment[];
  marketplaceEnabled: boolean;
  provinceCode: string | null;
  communeCode: string | null;
  lat: number | null;
  lng: number | null;
}
export interface ProductListing {
  productId: string;
  name: string;
  unit: string;
  sellingPrice: number;
  imageUrl: string | null;
  stockQuantity: number;
  inStock: boolean;
  published: boolean;
  agrilinkPrice: number | null;
  /** Tên hiển thị trên AgriLink ('' = tên AgriPOS). */
  title?: string;
  /** Quy cách hiển thị ('' = đơn vị AgriPOS). */
  listingUnit?: string;
  description?: string;
  images?: string[];
  salePrice?: number | null;
  saleEndsAt?: string | null;
  saleActive?: boolean;
  /** Giá thực tính tiền (sau khuyến mãi nếu đang hiệu lực). */
  effectivePrice?: number;
}
/** Dữ liệu gửi khi lưu tin bán vật tư; trường không gửi được giữ nguyên. */
export interface ProductListingInput {
  published: boolean;
  price?: number | null;
  title?: string;
  unit?: string;
  description?: string;
  images?: string[];
  salePrice?: number | null;
  saleEndsAt?: string | null;
}
export interface BuyOffer {
  id: string;
  title: string;
  commodityType: CommodityType | null;
  unit: string;
  price: number;
  active: boolean;
  updatedAt: string;
  cropId: string | null;
  maxQuantityKg: number | null;
  validUntil: string | null;
  priceUpdatedAt: string;
  priceAgeHours: number;
  stale: boolean;
  market: { pricePerKg: number; scope: 'province' | 'region'; provinceName: string | null; recordedAt: string; source: string } | null;
}
export type ServiceKind = 'farm_pickup' | 'supply_delivery';
export interface DealerService {
  kind: ServiceKind;
  active: boolean;
  cropIds: string[];
  areaMode: 'radius' | 'provinces';
  radiusKm: number | null;
  provinceCodes: string[];
  feeMode: 'free' | 'per_trip' | 'per_kg';
  feeAmount: number;
  minQuantityKg: number;
  leadTimeHours: number;
  note: string;
  windows: { weekday: number; session: 'morning' | 'afternoon'; capacity: number }[];
}
export interface DealerRating {
  id: string;
  orderId: string;
  stars: number;
  tags: { accurateWeight: boolean | null; paidOnTime: boolean | null; onTime: boolean | null; asDescribed: boolean | null };
  comment: string;
  hidden: boolean;
  hiddenReason: string | null;
  createdAt: string;
}
export interface RatingAggregates {
  avgStars: number | null;
  count: number;
  accurateWeightPct: number | null;
  paidOnTimePct: number | null;
  onTimePct: number | null;
  asDescribedPct: number | null;
}
export interface Verification {
  status: 'pending' | 'verified' | 'rejected';
  legalName: string;
  taxCode: string;
  businessAddress: string;
  submittedAt: string;
  reviewedAt: string | null;
  note: string;
}
export interface PlatformVerification extends Verification {
  organizationId: string;
  organizationName: string;
  provinceName: string | null;
}
export interface ManageStats {
  newOrders: number;
  pendingOrders: number;
  inProgress: number;
  acceptanceRate: number | null;
  completedBuyRevenue: number;
  completedSellKg: number;
  completedSellAmount: number;
}
export interface ChannelRevenue {
  source: 'pos' | 'agrilink';
  orders: number;
  revenue: number;
  profit: number;
}
export interface OrdersPageData {
  items: OrderSummary[];
  total: number;
  counts: Record<OrderStatus, number>;
}
export interface ProductsPageData {
  items: ProductListing[];
  total: number;
}
export interface MatchData {
  linked: Party | null;
  suggestions: Party[];
}
