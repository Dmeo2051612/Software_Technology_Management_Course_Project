import { normalizeVi } from '../agri-reference/normalize';
import { bookable, hasCapacity } from './booking';

export const HAUL_COST_PER_KG_KM = 4;
export const DEFAULT_MAX_KM = 150;
export type Session = { date: string; session: 'morning' | 'afternoon' };
export type Service = {
  active: boolean;
  cropIds: string[];
  areaMode: 'radius' | 'provinces';
  radiusKm: number | null;
  provinceCodes: string[];
  feeMode: 'free' | 'per_trip' | 'per_kg';
  feeAmount: number;
  minQuantityKg: number;
  leadTimeHours: number;
  windows: {
    weekday: number;
    session: 'morning' | 'afternoon';
    capacity?: number;
  }[];
  bookings?: { date: string; session: 'morning' | 'afternoon'; used: number }[];
};
export type IntentForMatch = {
  requesterId: string;
  ownOrganizationIds?: string[];
  side: 'sell' | 'buy';
  cropId: string | null;
  productQuery: string | null;
  quantityKg: number | null;
  provinceCode: string;
  windowStart: string;
  windowEnd: string;
  fulfillmentPref: 'pickup' | 'dropoff' | 'any';
  lat: number | null;
  lng: number | null;
};
export type Candidate = {
  dealer: {
    id: string;
    name: string;
    logoUrl: string | null;
    provinceName: string | null;
    verified?: boolean;
  };
  lat: number | null;
  lng: number | null;
  completedOrders: number;
  ratings?: { avgStars: number | null; count: number; accurateWeightPct: number | null };
  offer?: {
    offerId: string;
    price: number;
    unit: string;
    maxQuantityKg: number | null;
    priceUpdatedAt?: string | Date;
    priceFreshness?: 'today' | 'yesterday' | 'older';
  };
  products?: {
    offerId: string;
    name: string;
    unit: string;
    price: number;
    inStock: boolean;
  }[];
  pickup?: Service | null;
  delivery?: Service | null;
};
export type ScoredMatch = Candidate & {
  score: number;
  distanceKm: number | null;
  effectivePrice: number | null;
  pickup: {
    available: boolean;
    nextSession: Session | null;
    feePerKg: number;
  } | null;
  delivery: {
    available: boolean;
    nextSession: Session | null;
    feePerKg: number;
  } | null;
  reliability: { completedOrders: number; avgStars: number | null; ratingCount: number; accurateWeightPct: number | null };
  market?: { pricePerKg: number; recordedAt: string; scope: string; provinceName: string | null; source: string } | null;
  vsMarketPct?: number | null;
  reasons: string[];
};
const numeric = (n: number | null | undefined) =>
  n == null ? null : Number(n);
export function distanceKm(
  a: { lat: number | null; lng: number | null },
  b: { lat: number | null; lng: number | null },
): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null)
    return null;
  const r = Math.PI / 180,
    dLat = (Number(b.lat) - Number(a.lat)) * r,
    dLng = (Number(b.lng) - Number(a.lng)) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(Number(a.lat) * r) *
      Math.cos(Number(b.lat) * r) *
      Math.sin(dLng / 2) ** 2;
  return 1.3 * 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function covers(
  s: Service | null | undefined,
  i: IntentForMatch,
  d: number | null,
): boolean {
  return (
    !!s?.active &&
    (s.areaMode === 'provinces'
      ? s.provinceCodes.includes(i.provinceCode)
      : d !== null && s.radiusKm !== null && d <= s.radiusKm)
  );
}
export function nextSession(
  s: Service,
  i: IntentForMatch,
  now: Date,
): Session | null {
  for (
    let t = Date.parse(`${i.windowStart}T00:00:00Z`);
    t <= Date.parse(`${i.windowEnd}T00:00:00Z`);
    t += 86400000
  ) {
    const date = new Date(t).toISOString().slice(0, 10),
      weekday = new Date(t).getUTCDay();
    for (const session of ['morning', 'afternoon'] as const) {
      if (
        !s.windows.some((w) => w.weekday === weekday && w.session === session)
      )
        continue;
      const window = s.windows.find(
        (w) => w.weekday === weekday && w.session === session,
      );
      const used = s.bookings?.find(
        (b) => b.date === date && b.session === session,
      )?.used ?? 0;
      if (window?.capacity != null && !hasCapacity(window.capacity, used))
        continue;
      if (bookable(date, session, s.leadTimeHours, now))
        return { date, session };
    }
  }
  return null;
}
export function productTokens(query: string): string[] {
  return normalizeVi(query)
    .split(' ')
    .filter(
      (t) =>
        t.length >= 2 &&
        !/^\d+$/.test(t) &&
        !['kg', 'ky', 'ki', 'tan', 'ta', 'bao', 'bich'].includes(t),
    );
}
const proximity = (d: number | null) =>
  d === null ? 0.5 : Math.max(0, 1 - d / DEFAULT_MAX_KM);
export const reliability = (n: number, ratingCount = 0, avgStars: number | null = null) => {
  const volume = Math.min(1, Math.log1p(n) / Math.log(21));
  return ratingCount >= 3 && avgStars != null ? 0.6 * volume + 0.4 * (avgStars - 1) / 4 : volume;
};
export function scoreCandidates(
  i: IntentForMatch,
  candidates: Candidate[],
  now: Date,
  limit = 5,
): ScoredMatch[] {
  const own = candidates.filter(
    (c) => !i.ownOrganizationIds?.includes(c.dealer.id),
  );
  const prepared = own
    .map((c) => {
      const d = distanceKm(i, c),
        pickupAvailable =
          covers(c.pickup, i, d) &&
          (!c.pickup?.cropIds?.length ||
            (!!i.cropId && c.pickup.cropIds.includes(i.cropId))) &&
          (i.quantityKg == null ||
            (c.pickup?.minQuantityKg ?? 0) <= i.quantityKg);
      const deliveryAvailable = covers(c.delivery, i, d);
      const pickupSession =
        pickupAvailable && c.pickup ? nextSession(c.pickup, i, now) : null;
      const deliverySession =
        deliveryAvailable && c.delivery
          ? nextSession(c.delivery, i, now)
          : null;
      const fee = (s: Service | null | undefined) =>
        !s || s.feeMode === 'free'
          ? 0
          : s.feeMode === 'per_kg'
            ? Number(s.feeAmount)
            : Number(s.feeAmount) / Math.max(i.quantityKg ?? 0, 1000);
      const cost =
        i.side === 'sell' && pickupAvailable && i.fulfillmentPref !== 'dropoff'
          ? fee(c.pickup)
          : d === null
            ? 0
            : HAUL_COST_PER_KG_KM * d;
      return {
        ...c,
        distanceKm: d,
        effectivePrice:
          i.side === 'sell' && c.offer ? Number(c.offer.price) - cost : null,
        pickup:
          i.side === 'sell'
            ? {
                available: pickupAvailable,
                nextSession: pickupSession,
                feePerKg: pickupAvailable ? fee(c.pickup) : 0,
              }
            : null,
        delivery:
          i.side === 'buy'
            ? {
                available: deliveryAvailable,
                nextSession: deliverySession,
                feePerKg: deliveryAvailable ? fee(c.delivery) : 0,
              }
            : null,
        reliability: { completedOrders: Number(c.completedOrders), avgStars: c.ratings?.avgStars ?? null, ratingCount: c.ratings?.count ?? 0, accurateWeightPct: c.ratings?.accurateWeightPct ?? null },
        score: 0,
        reasons: [],
      } as ScoredMatch;
    })
    .filter(
      (c) =>
        c.distanceKm === null ||
        c.distanceKm <= DEFAULT_MAX_KM ||
        (i.side === 'sell' ? c.pickup?.available : c.delivery?.available),
    );
  if (i.side === 'sell') {
    let selected = prepared.filter((c) => !!c.offer);
    if (
      i.fulfillmentPref === 'pickup' &&
      selected.some((c) => c.pickup?.available)
    )
      selected = selected.filter((c) => c.pickup?.available);
    const max = Math.max(0, ...selected.map((c) => c.effectivePrice ?? 0));
    for (const c of selected) {
      const capacity =
        c.offer?.maxQuantityKg == null ||
        i.quantityKg == null ||
        numeric(c.offer.maxQuantityKg)! >= i.quantityKg;
      const convenience =
        i.fulfillmentPref === 'dropoff'
          ? 0.5
          : c.pickup?.available
            ? c.pickup.nextSession
              ? 1
              : 0.5
            : 0;
      c.score =
        50 * (max > 0 ? Math.max(0, c.effectivePrice ?? 0) / max : 0) +
        20 * convenience +
        15 * reliability(c.completedOrders, c.ratings?.count, c.ratings?.avgStars) +
        10 * Number(capacity) +
        5 * proximity(c.distanceKm);
    }
    const ranked = selected.sort(
      (a, b) =>
        b.score - a.score || (b.effectivePrice ?? 0) - (a.effectivePrice ?? 0),
    );
    return ranked
      .filter(
        (c, index) =>
          ranked.findIndex((x) => x.dealer.id === c.dealer.id) === index,
      )
      .slice(0, limit);
  }
  const tokens = productTokens(i.productQuery ?? '');
  const selected = prepared
    .filter((c) => !!c.products?.length)
    .map((c) => {
      const matches = c
        .products!.map((p) => ({
          p,
          matched: tokens.filter((t) =>
            normalizeVi(p.name).split(' ').includes(t),
          ).length,
        }))
        .filter((x) => tokens.length && x.matched === tokens.length)
        .slice(0, 5);
      c.products = matches.slice(0, 3).map((x) => x.p);
      const best = matches[0]?.matched ?? 0;
      c.score =
        40 * (tokens.length ? best / tokens.length : 0) +
        20 * Number(matches.some((x) => x.p.inStock)) +
        20 * (c.delivery?.available ? (c.delivery.nextSession ? 1 : 0.5) : 0) +
        15 * reliability(c.completedOrders, c.ratings?.count, c.ratings?.avgStars) +
        5 * proximity(c.distanceKm);
      return c;
    })
    .filter((c) => !!c.products?.length);
  return selected.sort((a, b) => b.score - a.score).slice(0, limit);
}
