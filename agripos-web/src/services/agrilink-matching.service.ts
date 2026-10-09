import api from './api';
import type { ChooseIntentInput, Commune, ContactInput, CreateIntentInput, Crop, DailyPrices, Intent, IntentDetail, Match, ParsedIntent, Province, RatingInput, ResolvedPlace, Slot, IntentStatus, DealerLead, DealerLeadOffer, CreateDealerLeadOffer, IntentSide } from './agrilink-matching.types';
import type { OrderDetail } from './agrilink.types';

const unwrap = async <T>(request: Promise<{ data: { data: T } }>): Promise<T> => (await request).data.data;
const base = '/marketplace';
export const matchingApi = {
  parse: (text: string) => unwrap<ParsedIntent>(api.post(`${base}/intents/parse`, { text })),
  /** Đại lý phù hợp với nhu cầu chưa lưu (không tạo nhu cầu, không báo đại lý). */
  preview: (input: CreateIntentInput) => unwrap<{ matches: Match[] }>(api.post(`${base}/intents/preview`, input)),
  create: (input: CreateIntentInput) => unwrap<{ intent: Intent; matches: Match[] }>(api.post(`${base}/intents`, input)),
  mine: (status?: IntentStatus) => unwrap<Intent[]>(api.get(`${base}/my-intents`, { params: status ? { status } : {} })),
  detail: (id: string) => unwrap<IntentDetail>(api.get(`${base}/my-intents/${id}`)),
  close: (id: string, reason?: string) => unwrap<{ id: string; status: IntentStatus }>(api.post(`${base}/my-intents/${id}/close`, reason ? { reason } : {})),
  choose: (id: string, input: ChooseIntentInput) => unwrap<{ intent: Intent; order: OrderDetail }>(api.post(`${base}/my-intents/${id}/choose`, input)),
  accept: (id: string, offerId: string, input: ContactInput) => unwrap<{ intent: Intent; order: OrderDetail }>(api.post(`${base}/my-intents/${id}/offers/${offerId}/accept`, input)),
  decline: (id: string, offerId: string) => unwrap<{ id: string; status: string }>(api.post(`${base}/my-intents/${id}/offers/${offerId}/decline`)),
  availability: (dealerId: string, kind: 'farm_pickup' | 'supply_delivery', from: string, to: string) => unwrap<Slot[]>(api.get(`${base}/dealers/${dealerId}/availability`, { params: { kind, from, to } })),
  rate: (orderId: string, input: RatingInput) => unwrap<unknown>(api.post(`${base}/my-orders/${orderId}/rating`, input)),
  crops: () => unwrap<Crop[]>(api.get('/agri/crops')),
  provinces: () => unwrap<Province[]>(api.get('/agri/provinces')),
  communes: (provinceCode: string, q = '') => unwrap<Commune[]>(api.get(`/agri/provinces/${provinceCode}/communes`, { params: { q } })),
  resolvePlace: (q: string) => unwrap<ResolvedPlace[]>(api.get('/agri/resolve-place', { params: { q } })),
  dailyPrices: () => unwrap<DailyPrices>(api.get('/agri/daily-prices')),
  leads: (side?: IntentSide, cropId?: string) => unwrap<DealerLead[]>(api.get(`${base}/manage/leads`, { params: { ...(side ? { side } : {}), ...(cropId ? { cropId } : {}) } })),
  leadOffers: (status?: DealerLeadOffer['status']) => unwrap<DealerLeadOffer[]>(api.get(`${base}/manage/lead-offers`, { params: status ? { status } : {} })),
  createLeadOffer: (intentId: string, input: CreateDealerLeadOffer) => unwrap<DealerLeadOffer>(api.post(`${base}/manage/leads/${intentId}/offers`, input)),
  withdrawLeadOffer: (id: string) => unwrap<{ id: string; status: string }>(api.post(`${base}/manage/lead-offers/${id}/withdraw`)),
};
