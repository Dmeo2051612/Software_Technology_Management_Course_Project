/** Tiện ích cho tin bán vật tư và giá khuyến mãi. */

const VN_OFFSET_MS = 7 * 3600 * 1000;

/** Phần trăm giảm, làm tròn; 0 nếu không giảm. */
export function discountPercent(original: number, price: number): number {
  if (!(original > 0) || price >= original) return 0;
  return Math.round(((original - price) / original) * 100);
}

/** Ngày chọn (YYYY-MM-DD) → 23:59:59 ngày đó theo giờ Việt Nam, dạng ISO. */
export function saleEndIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59) - VN_OFFSET_MS).toISOString();
}

/** ISO → ngày theo giờ Việt Nam cho ô chọn ngày. */
export function saleEndDateInput(iso: string): string {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** "KM đến dd/mm" theo giờ Việt Nam. */
export function saleEndLabel(iso: string): string {
  const [, m, d] = saleEndDateInput(iso).split('-');
  return `KM đến ${d}/${m}`;
}
