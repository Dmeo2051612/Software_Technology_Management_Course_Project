export const BUY_OFFER_STALE_HOURS = 48;
export const BUY_OFFER_REMIND_HOURS = 36;

export function vnDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function priceAgeHours(
  updated: string | Date,
  now = new Date(),
): number {
  return Math.max(0, (now.getTime() - new Date(updated).getTime()) / 3600000);
}

export function stalePrice(updated: string | Date, now = new Date()): boolean {
  return priceAgeHours(updated, now) >= BUY_OFFER_STALE_HOURS;
}

export function priceFreshness(
  updated: string | Date,
  now = new Date(),
): 'today' | 'yesterday' | 'older' {
  const day = vnDay(new Date(updated));
  if (day === vnDay(now)) return 'today';
  if (day === vnDay(new Date(now.getTime() - 86400000))) return 'yesterday';
  return 'older';
}

export function vsMarketPct(
  price: number,
  market: { pricePerKg: number } | null,
): number | null {
  return market?.pricePerKg
    ? Math.round(((price - market.pricePerKg) / market.pricePerKg) * 1000) / 10
    : null;
}
