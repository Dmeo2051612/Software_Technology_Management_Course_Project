/**
 * Một quy tắc giá duy nhất cho tin bán vật tư (agrilink_offers kind='sale' + products).
 * Dùng chung cho quản lý sản phẩm, gian hàng, đặt đơn và gợi ý mua vật tư để
 * giá hiển thị và giá tính tiền luôn khớp.
 */
export function saleOfferSql(f = 'f', p = 'p') {
  const base = `COALESCE(${f}.price,${p}."sellingPrice")`;
  const promo = `(${f}.sale_price IS NOT NULL AND ${f}.sale_ends_at > now() AND ${f}.sale_price < ${base})`;
  return {
    /** Tên hiển thị trên AgriLink ('' = tên sản phẩm AgriPOS). */
    name: `COALESCE(NULLIF(${f}.title,''),${p}.name)`,
    /** Quy cách hiển thị ('' = đơn vị sản phẩm AgriPOS). */
    unit: `COALESCE(NULLIF(${f}.unit,''),${p}.unit)`,
    /** Giá bán online trước khuyến mãi. */
    base,
    /** Khuyến mãi đang hiệu lực. */
    promo,
    /** Giá thực tính tiền. */
    price: `CASE WHEN ${promo} THEN ${f}.sale_price ELSE ${base} END`,
  };
}
