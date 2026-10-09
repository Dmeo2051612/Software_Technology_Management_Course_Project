import api from './api';

/** api mặc định gửi JSON; FormData cần khai báo multipart để không bị đổi thành JSON. */
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };
import type {
  BuyOffer,
  ChannelRevenue,
  CompleteInput,
  DealerCard,
  DealerProfile,
  MatchData,
  ManageStats,
  OrderDetail,
  OrderSummary,
  OrdersPageData,
  OrderStatus,
  PlaceOrderInput,
  ProductListing,
  ProductListingInput,
  ProductsPageData,
  Storefront,
  ManagedVoucher,
  VoucherInput,
  VouchersPageData,
  DealerService, ServiceKind, DealerRating, RatingAggregates, Verification, PlatformVerification,
} from './agrilink.types';

const unwrap = async <T>(request: Promise<{ data: { data: T } }>): Promise<T> =>
  (await request).data.data;
const buyer = '/marketplace';
const manage = '/agrilink-manage';
const storefrontManage = '/marketplace/manage';

export const agrilinkBuyerApi = {
  dealers: (q = '', crop = '', province = '') =>
    unwrap<DealerCard[]>(
      api.get(`${buyer}/dealers`, { params: { q, ...(crop ? { crop } : {}), ...(province ? { province } : {}) } }),
    ),
  storefront: (id: string) => unwrap<Storefront>(api.get(`${buyer}/dealers/${id}`)),
  placeOrder: (dealerId: string, input: PlaceOrderInput) =>
    unwrap<OrderDetail>(api.post(`${buyer}/dealers/${dealerId}/orders`, input)),
  myOrders: (status?: OrderStatus) =>
    unwrap<OrderSummary[]>(api.get(`${buyer}/my-orders`, { params: status ? { status } : {} })),
  myOrder: (id: string) => unwrap<OrderDetail>(api.get(`${buyer}/my-orders/${id}`)),
  saveVoucher: (id: string) => unwrap<{ saved: boolean }>(api.post(`${buyer}/vouchers/${id}/save`)),
  cancelMyOrder: (id: string, reason?: string) =>
    unwrap<OrderDetail>(api.post(`${buyer}/my-orders/${id}/cancel`, { reason })),
};

export const agrilinkManageApi = {
  stats: (from: string, to: string) =>
    unwrap<ManageStats>(api.get(`${manage}/stats`, { params: { from, to } })),
  orders: (params: {
    status?: OrderStatus;
    kind?: 'buy' | 'sell';
    q?: string;
    page?: number;
    limit?: number;
  }) => unwrap<OrdersPageData>(api.get(`${manage}/orders`, { params })),
  order: (id: string) => unwrap<OrderDetail>(api.get(`${manage}/orders/${id}`)),
  match: (id: string) => unwrap<MatchData>(api.get(`${manage}/orders/${id}/match`)),
  updateItems: (id: string, items: { itemId: string; quantity: number; unitPrice: number }[]) =>
    unwrap<OrderDetail>(api.patch(`${manage}/orders/${id}/items`, { items })),
  confirm: (id: string) => unwrap<OrderDetail>(api.post(`${manage}/orders/${id}/confirm`)),
  reject: (id: string, reason: string) =>
    unwrap<OrderDetail>(api.post(`${manage}/orders/${id}/reject`, { reason })),
  deliver: (id: string) => unwrap<OrderDetail>(api.post(`${manage}/orders/${id}/deliver`)),
  cancel: (id: string, reason: string) =>
    unwrap<OrderDetail>(api.post(`${manage}/orders/${id}/cancel`, { reason })),
  complete: (id: string, input: CompleteInput) =>
    unwrap<OrderDetail>(api.post(`${manage}/orders/${id}/complete`, input)),
  profile: () => unwrap<DealerProfile>(api.get(`${storefrontManage}/profile`)),
  updateProfile: (patch: Partial<Omit<DealerProfile, 'logoUrl' | 'coverUrl'>>) =>
    unwrap<DealerProfile>(api.patch(`${storefrontManage}/profile`, patch)),
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<{ logoUrl: string }>(api.post(`${storefrontManage}/profile/logo`, form, MULTIPART));
  },
  uploadCover: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<{ coverUrl: string }>(api.post(`${storefrontManage}/profile/cover`, form, MULTIPART));
  },
  products: (params: { q?: string; published?: boolean; page?: number; limit?: number }) =>
    unwrap<ProductsPageData>(
      api.get(`${storefrontManage}/products`, {
        params: {
          ...params,
          ...(params.published === undefined ? {} : { published: String(params.published) }),
        },
      }),
    ),
  setProduct: (productId: string, data: ProductListingInput) =>
    unwrap<ProductListing>(api.put(`${storefrontManage}/products/${productId}`, data)),
  uploadListingImage: (productId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<{ url: string }>(api.post(`${storefrontManage}/products/${productId}/images`, form, MULTIPART));
  },
  vouchers: () => unwrap<VouchersPageData>(api.get(`${storefrontManage}/vouchers`)),
  createVoucher: (input: VoucherInput) =>
    unwrap<ManagedVoucher>(api.post(`${storefrontManage}/vouchers`, input)),
  updateVoucher: (id: string, patch: VoucherInput) =>
    unwrap<ManagedVoucher>(api.patch(`${storefrontManage}/vouchers/${id}`, patch)),
  removeVoucher: (id: string) => unwrap<{ id: string }>(api.delete(`${storefrontManage}/vouchers/${id}`)),
  buyOffers: () => unwrap<BuyOffer[]>(api.get(`${storefrontManage}/buy-offers`)),
  addBuyOffer: (input: {
    title: string;
    cropId?: string;
    commodityType?: 'coffee_fresh' | 'coffee_bean' | 'pepper';
    unit: string;
    price: number;
    maxQuantityKg?: number;
    validUntil?: string;
  }) => unwrap<BuyOffer>(api.post(`${storefrontManage}/buy-offers`, input)),
  updateBuyOffer: (id: string, patch: { title?: string; price?: number; active?: boolean; maxQuantityKg?: number | null; validUntil?: string | null }) =>
    unwrap<BuyOffer>(api.patch(`${storefrontManage}/buy-offers/${id}`, patch)),
  confirmBuyOffer: (id: string) => unwrap<BuyOffer>(api.post(`${storefrontManage}/buy-offers/${id}/confirm-price`)),
  confirmAllBuyOffers: () => unwrap<{ count: number }>(api.post(`${storefrontManage}/buy-offers/confirm-all`)),
  services: () => unwrap<(DealerService | null)[]>(api.get(`${storefrontManage}/services`)),
  putService: (kind: ServiceKind, input: Omit<DealerService, 'kind'>) =>
    unwrap<DealerService>(api.put(`${storefrontManage}/services/${kind}`, input)),
  ratings: (page = 1) => unwrap<{ items: DealerRating[]; aggregates: RatingAggregates }>(api.get(`${storefrontManage}/ratings`, { params: { page } })),
  verification: () => unwrap<Verification | null>(api.get(`${storefrontManage}/verification`)),
  submitVerification: (input: { legalName: string; taxCode: string; businessAddress: string }) =>
    unwrap<Verification>(api.post(`${storefrontManage}/verification`, input)),
  removeBuyOffer: (id: string) =>
    unwrap<{ id: string }>(api.delete(`${storefrontManage}/buy-offers/${id}`)),
};
export const agrilinkPlatformApi = {
  verifications: (status?: Verification['status']) =>
    unwrap<PlatformVerification[]>(api.get('/platform/agrilink/verifications', { params: status ? { status } : {} })),
  decide: (orgId: string, action: 'approve' | 'reject' | 'revoke', note?: string) =>
    unwrap<{ organizationId: string; status: Verification['status'] }>(api.post(`/platform/agrilink/verifications/${orgId}/${action}`, note ? { note } : {})),
};
export const channelStatsApi = {
  bySource: (from: string, to: string) =>
    unwrap<ChannelRevenue[]>(api.get('/orders/stats/by-source', { params: { from, to } })),
};
export function apiError(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data?.message;
  return Array.isArray(message)
    ? message.join(', ')
    : message || 'Có lỗi xảy ra, vui lòng thử lại.';
}
