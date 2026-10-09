/** Local end-to-end check for dealer vouchers (đợt D). */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const base =
  process.env.SMOKE_BASE_URL ||
  `http://127.0.0.1:${process.env.APP_PORT || 3000}/api/v1`;
const dealerId = '00000000-0000-4000-8000-000000000002';
const day = 86400000;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function call(path, { token, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (response.status !== expected)
    throw new Error(`${method} ${path}: HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return expected < 300 ? payload.data : payload;
}

async function login(email) {
  const data = await call('/auth/login', {
    method: 'POST',
    body: { email, password: process.env.SEED_FARMER_PASSWORD },
    expected: 201,
  });
  assert(data?.accessToken, `Missing token for ${email}`);
  return data.accessToken;
}

async function main() {
  assert(
    process.env.NODE_ENV !== 'production' &&
      /^http:\/\/(127\.0\.0\.1|localhost):\d+\/api\/v1$/.test(base),
    'Smoke must target the local API.',
  );
  assert(process.env.SEED_FARMER_PASSWORD, 'SEED_FARMER_PASSWORD is required.');
  const dealer = await login('dealer-demo@agrilink.vn');
  const farmer = await login('farmer-demo@agrilink.vn');

  const bad = await call('/marketplace/manage/vouchers', {
    token: dealer,
    method: 'POST',
    body: { title: 'Sai', type: 'amount', value: 20000, minOrder: 1000, quantity: 5,
      startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + day).toISOString() },
    expected: 400,
  });
  assert(/Đơn tối thiểu/.test(bad.message), 'Amount voucher must require a minimum ≥ value.');

  const voucher = await call('/marketplace/manage/vouchers', {
    token: dealer,
    method: 'POST',
    body: { title: `Smoke giảm 5% ${Date.now()}`, type: 'percent', value: 5, maxDiscount: 50000,
      minOrder: 100000, quantity: 2, startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 7 * day).toISOString() },
    expected: 201,
  });
  assert(voucher.state === 'running', 'New voucher must be running.');

  let store = await call(`/marketplace/dealers/${dealerId}`, { token: farmer });
  let listed = store.vouchers.find((v) => v.id === voucher.id);
  assert(listed && !listed.saved && listed.remaining === 2, 'Storefront must list the unsaved voucher.');
  await call(`/marketplace/vouchers/${voucher.id}/save`, { token: farmer, method: 'POST', expected: 201 });
  await call(`/marketplace/vouchers/${voucher.id}/save`, { token: farmer, method: 'POST', expected: 201 });
  store = await call(`/marketplace/dealers/${dealerId}`, { token: farmer });
  assert(store.vouchers.find((v) => v.id === voucher.id).saved, 'Saved flag must be set.');
  await call(`/marketplace/vouchers/${voucher.id}/save`, { token: dealer, method: 'POST', expected: 400 });

  const offer =
    store.saleOffers.find((o) => o.inStock && o.price > 0) ?? store.saleOffers.find((o) => o.price > 0);
  assert(offer, 'Dealer needs a sale offer.');
  const quantity = Math.max(1, Math.ceil(120000 / offer.price));
  const subtotal = Math.round(quantity * offer.price);
  const expectedDiscount = Math.min(Math.round(subtotal * 0.05), 50000);
  const order = (extra = {}) =>
    call(`/marketplace/dealers/${dealerId}/orders`, {
      token: farmer,
      method: 'POST',
      body: { kind: 'buy', fulfillment: 'pickup', contactName: 'Nông dân smoke', contactPhone: '0901234567',
        items: [{ offerId: offer.offerId, quantity }], voucherId: voucher.id, ...extra },
      expected: 201,
    });

  const first = await order();
  assert(first.discountAmount === expectedDiscount && first.estimatedTotal === subtotal,
    `Discount ${first.discountAmount} ≠ ${expectedDiscount}.`);
  assert(first.voucherTitle === voucher.title, 'Order must show the voucher title.');
  const again = await call(`/marketplace/dealers/${dealerId}/orders`, {
    token: farmer, method: 'POST', expected: 400,
    body: { kind: 'buy', fulfillment: 'pickup', contactName: 'Nông dân smoke', contactPhone: '0901234567',
      items: [{ offerId: offer.offerId, quantity }], voucherId: voucher.id },
  });
  assert(again.message === 'Bạn đã dùng voucher này.', `Reuse message: ${again.message}`);

  await call(`/marketplace/my-orders/${first.id}/cancel`, { token: farmer, method: 'POST', body: { reason: 'Smoke' }, expected: 201 });
  let managed = await call('/marketplace/manage/vouchers', { token: dealer });
  assert(managed.items.find((v) => v.id === voucher.id).usedCount === 0, 'Cancel must give the use back.');

  // Đại lý từ chối chạy dưới RLS (agrilink-manage) — cũng phải hoàn lượt.
  const rejected = await order();
  await call(`/agrilink-manage/orders/${rejected.id}/reject`, { token: dealer, method: 'POST', body: { reason: 'Smoke' }, expected: 201 });
  managed = await call('/marketplace/manage/vouchers', { token: dealer });
  assert(managed.items.find((v) => v.id === voucher.id).usedCount === 0, 'Dealer reject must give the use back.');

  const second = await order();
  await call(`/agrilink-manage/orders/${second.id}/confirm`, { token: dealer, method: 'POST', expected: 201 });
  const detail = await call(`/agrilink-manage/orders/${second.id}`, { token: dealer });
  assert(detail.discountAmount === expectedDiscount && detail.voucherTitle === voucher.title, 'Dealer detail must show the voucher.');
  const tooMuch = await call(`/agrilink-manage/orders/${second.id}/complete`, {
    token: dealer, method: 'POST', expected: 400,
    body: { party: { createNew: true }, paymentMethod: 'cash', paidAmount: subtotal,
      items: detail.items.map((i) => ({ itemId: i.id, quantity: i.quantity, unitPrice: i.unitPrice })) },
  });
  assert(/vượt tổng đơn/.test(tooMuch.message), 'Paying the gross total must be refused.');
  const completed = await call(`/agrilink-manage/orders/${second.id}/complete`, {
    token: dealer, method: 'POST', expected: 201,
    body: { party: { createNew: true }, paymentMethod: 'cash', paidAmount: subtotal - expectedDiscount,
      items: detail.items.map((i) => ({ itemId: i.id, quantity: i.quantity, unitPrice: i.unitPrice })) },
  });
  assert(completed.finalTotal === subtotal - expectedDiscount, `finalTotal ${completed.finalTotal}.`);

  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  await db.connect();
  try {
    const { rows: [pos] } = await db.query(
      'SELECT subtotal::float,discount::float,total::float,"paymentStatus" FROM orders WHERE id=$1',
      [completed.posRef.id],
    );
    assert(pos.discount === expectedDiscount && pos.total === subtotal - expectedDiscount && pos.subtotal === subtotal,
      `POS order ${JSON.stringify(pos)}.`);
  } finally {
    await db.end();
  }

  managed = await call('/marketplace/manage/vouchers', { token: dealer });
  const used = managed.items.find((v) => v.id === voucher.id);
  assert(used.usedCount === 1 && used.savedCount === 1, 'Voucher must count one use.');
  await call(`/marketplace/manage/vouchers/${voucher.id}`, { token: dealer, method: 'DELETE', expected: 400 });
  const stopped = await call(`/marketplace/manage/vouchers/${voucher.id}`, { token: dealer, method: 'PATCH', body: { active: false } });
  assert(stopped.state === 'stopped', 'Stop must work on a used voucher.');
  console.log(`AgriLink voucher smoke passed (giảm ${expectedDiscount} đ trên ${subtotal} đ).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
