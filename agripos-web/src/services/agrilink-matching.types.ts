export type IntentSide = 'sell' | 'buy';
export type IntentStatus = 'open' | 'matched' | 'closed' | 'expired' | 'cancelled';
export type Session = 'morning' | 'afternoon';
export type FulfillmentPref = 'pickup' | 'dropoff' | 'any';
export type Fulfillment = 'pickup' | 'delivery' | 'at_dealer';

export interface ParsedIntent {
  /** Bộ đã phân tích câu: luật, hay một mô hình ngôn ngữ. */
  parser?: 'rules' | 'gemini' | 'deepseek';
  side: IntentSide | null;
  cropId: string | null;
  cropName: string | null;
  cropCandidates: { id: string; name: string }[];
  productQuery: string | null;
  quantityKg: number | null;
  quantityText: string;
  provinceCode: string | null;
  communeCode: string | null;
  placeSource: 'text' | 'profile' | null;
  windowStart: string;
  windowEnd: string;
  expectedPricePerKg: number | null;
  fulfillmentPref: FulfillmentPref;
  missing: ('side' | 'crop' | 'product' | 'quantity' | 'place')[];
  followUp: string | null;
  confidence: number;
}
export interface CreateIntentInput {
  rawText: string;
  side: IntentSide;
  cropId?: string;
  productQuery?: string;
  quantityKg?: number;
  quantityText?: string;
  provinceCode: string;
  communeCode?: string;
  windowStart: string;
  windowEnd: string;
  expectedPricePerKg?: number;
  fulfillmentPref: FulfillmentPref;
  note?: string;
}
export interface Intent extends CreateIntentInput {
  id: string;
  status: IntentStatus;
  cropName: string | null;
  provinceName: string;
  communeName: string | null;
  createdAt: string;
  matchCount?: number;
}
export interface Match {
  dealer: { id: string; name: string; logoUrl: string | null; provinceName: string | null; verified?: boolean };
  score: number;
  distanceKm: number | null;
  effectivePrice: number | null;
  offer?: { offerId: string; price: number; unit: string; maxQuantityKg: number | null; priceUpdatedAt?: string; priceFreshness?: 'today' | 'yesterday' | 'older' };
  products?: { offerId: string; name: string; unit: string; price: number; inStock: boolean }[];
  pickup: { available: boolean; nextSession: Slot | null; feePerKg: number } | null;
  delivery: { available: boolean; nextSession: Slot | null; feePerKg: number } | null;
  reliability: { completedOrders: number; avgStars: number | null; ratingCount: number; accurateWeightPct: number | null };
  market?: { pricePerKg: number; recordedAt: string; scope: string; provinceName: string | null; source: string } | null;
  vsMarketPct?: number | null;
  reasons: string[];
}
export interface IntentOffer {
  id: string;
  dealer: Match['dealer'];
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
  pricePerKg: number | null;
  effectivePrice: number | null;
  products: { offerId: string; name: string; quantity: number; price: number }[] | null;
  fulfillment: Fulfillment;
  scheduledDate: string | null;
  scheduledSession: Session | null;
  feePerKg: number;
  message: string;
  createdAt: string;
}
export interface IntentDetail { intent: Intent; matches: Match[]; offers: IntentOffer[] }
export interface Slot { date: string; session: Session; remaining?: number }
export interface ChooseIntentInput {
  organizationId: string;
  fulfillment: Fulfillment;
  scheduledDate?: string;
  scheduledSession?: Session;
  items?: { offerId: string; quantity?: number }[];
  contactName: string;
  contactPhone: string;
  address?: string;
}
export interface ContactInput { contactName: string; contactPhone: string; address?: string }
export interface RatingInput {
  stars: number;
  accurateWeight?: boolean;
  paidOnTime?: boolean;
  onTime?: boolean;
  asDescribed?: boolean;
  comment?: string;
}
export interface Crop { id: string; code: string; name: string; group: string; baseUnit: string; commodityType: string | null }
export interface DealerLead {
  intentId: string;
  side: IntentSide;
  crop: { id: string; name: string } | null;
  productQuery: string | null;
  quantityKg: number | null;
  quantityText: string;
  provinceName: string;
  communeName: string | null;
  distanceKm: number | null;
  windowStart: string;
  windowEnd: string;
  expectedPricePerKg: number | null;
  fulfillmentPref: FulfillmentPref;
  createdAt: string;
  myScore: number;
}
export interface DealerLeadOffer {
  id: string;
  intentId: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
  pricePerKg: number | null;
  fulfillment: Fulfillment;
  scheduledDate: string | null;
  scheduledSession: Session | null;
  feePerKg: number;
  message: string;
  createdAt: string;
  intent: { side: IntentSide; cropId: string | null; productQuery: string | null; quantityKg: number | null; provinceCode: string; windowStart: string; windowEnd: string };
}
export interface CreateDealerLeadOffer {
  pricePerKg?: number;
  products?: { offerId: string; quantity?: number }[];
  fulfillment: Fulfillment;
  scheduledDate?: string;
  scheduledSession?: Session;
  feePerKg?: number;
  message?: string;
}
export interface Province { code: string; name: string; kind: string }
export type Commune = Province;
export interface ResolvedPlace { provinceCode: string; provinceName: string; communeCode: string | null; communeName: string | null; matchedAlias: string; kind: string }

/** Giá nông sản hôm nay (GET /agri/daily-prices). */
export interface DailyPriceCommodity {
  key: 'coffee' | 'pepper';
  label: string;
  unit: string;
  regions: { name: string; price: number; change: number | null; recordedAt: string }[];
  world: { label: string; price: number; unit: string; recordedAt: string } | null;
  sources: string[];
  updatedAt: string | null;
}
export interface DailyPrices { commodities: DailyPriceCommodity[] }
