/**
 * End-to-end smoke test for the AgriLink dealer-portal ordering flow, run
 * against a REAL local Postgres database (RLS, triggers, FKs, transactions —
 * not mocks). Exercises the 12 scenarios from
 * .superpowers/sdd/2026-09-28-agrilink-dealer-portal-api/task-10-brief.md
 * against the API contract in spec §7
 * (docs/superpowers/specs/2026-09-28-agrilink-dealer-portal-design.md).
 *
 * Preconditions:
 *   - Local Postgres reachable with `community:setup`, `marketplace:setup`
 *     and `agrilink:setup` already applied (all idempotent — safe to re-run).
 *   - Demo accounts exist (see scripts/community-local.cjs `demo` mode):
 *       dealer-demo@agrilink.vn (owner, org "Đại lý An Phú · Demo")
 *       farmer-demo@agrilink.vn (farmer, no org)
 *       dtd2x                   (owner, legacy "AgriPOS" org — different org,
 *                                used only for the RLS-isolation check)
 *     dealer-demo / farmer-demo use SEED_FARMER_PASSWORD; dtd2x uses
 *     SEED_ADMIN_PASSWORD (both from .env).
 *   - API running locally; base URL via SMOKE_BASE_URL, default
 *     http://127.0.0.1:${APP_PORT||3000}/api/v1.
 *
 * This script WRITES demo data into the local dev DB on every run (new
 * products, offers, orders, customers/farmers, debts, weighing slips) —
 * that is expected and approved; nothing is cleaned up, and the script is
 * safe to re-run (all names are timestamp-suffixed).
 *
 * Run: npm run agrilink:smoke
 */
require('dotenv').config({ quiet: true });

const APP_PORT = process.env.APP_PORT || 3000;
const base =
  process.env.SMOKE_BASE_URL || `http://127.0.0.1:${APP_PORT}/api/v1`;
const DEALER_ORG_ID = '00000000-0000-4000-8000-000000000002';
const stamp = Date.now();

// Small delay between calls: several endpoints are throttled per-route
// (login 5/min, place-order 10/min, everything else defaults to 30/min per
// route+IP) — spacing calls keeps a full 12-scenario run comfortably under
// every bucket without needing long sleeps.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function call(path, { token, method = 'GET', body, expected } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* no/invalid JSON body */
  }
  const expectedList = expected == null ? null : [].concat(expected);
  if (expectedList && !expectedList.includes(res.status)) {
    throw new Error(
      `${method} ${path}: expected HTTP ${expectedList.join('|')}, got ${res.status} ${JSON.stringify(payload)}`,
    );
  }
  await wait(150);
  return {
    status: res.status,
    data: payload && payload.data,
    message: payload && payload.message,
    raw: payload,
  };
}

async function login(email, password) {
  const r = await call('/auth/login', {
    method: 'POST',
    body: { email, password },
    expected: [200, 201],
  });
  assert(
    r.data && r.data.accessToken,
    `login response missing accessToken for ${email}`,
  );
  return r.data.accessToken;
}

async function main() {
  if (
    process.env.NODE_ENV === 'production' ||
    !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/api\/v1$/.test(base)
  )
    throw new Error(
      'AgriLink smoke test only runs against a local development API.',
    );
  if (!process.env.SEED_FARMER_PASSWORD || !process.env.SEED_ADMIN_PASSWORD)
    throw new Error(
      'Missing local demo passwords (SEED_FARMER_PASSWORD / SEED_ADMIN_PASSWORD).',
    );

  const dealer = await login(
    'dealer-demo@agrilink.vn',
    process.env.SEED_FARMER_PASSWORD,
  );
  const farmer = await login(
    'farmer-demo@agrilink.vn',
    process.env.SEED_FARMER_PASSWORD,
  );
  const legacyOwner = await login('dtd2x', process.env.SEED_ADMIN_PASSWORD);

  // ── Scenario 1: dealer updates storefront profile ──────────────────────
  const profile = await call('/marketplace/manage/profile', {
    token: dealer,
    method: 'PATCH',
    body: {
      fulfillmentOptions: ['pickup', 'delivery'],
      marketplaceEnabled: true,
    },
    expected: 200,
  });
  assert(
    profile.data.marketplaceEnabled === true,
    'profile.marketplaceEnabled should be true',
  );
  assert(
    ['pickup', 'delivery'].every((f) =>
      profile.data.fulfillmentOptions.includes(f),
    ),
    'profile.fulfillmentOptions should include pickup and delivery',
  );
  console.log('1/12 profile updated (pickup+delivery, marketplace enabled)');

  // Dealer-demo may have zero products; create two through the normal API
  // so scenario 2 has something to publish (unique names per run).
  await call('/products', {
    token: dealer,
    method: 'POST',
    body: {
      name: `AgriLink QA Phân bón A ${stamp}`,
      unit: 'bao',
      sellingPrice: 200000,
    },
    expected: 201,
  });
  await call('/products', {
    token: dealer,
    method: 'POST',
    body: {
      name: `AgriLink QA Phân bón B ${stamp}`,
      unit: 'bao',
      sellingPrice: 300000,
    },
    expected: 201,
  });

  // ── Scenario 2: publish 2 products at marketplace ──────────────────────
  const productList = await call('/marketplace/manage/products?limit=2', {
    token: dealer,
    expected: 200,
  });
  assert(
    productList.data.items.length >= 2,
    'expected at least 2 products for dealer-demo',
  );
  const chosenProductIds = productList.data.items
    .slice(0, 2)
    .map((i) => i.productId);
  for (const productId of chosenProductIds) {
    const r = await call(`/marketplace/manage/products/${productId}`, {
      token: dealer,
      method: 'PUT',
      body: { published: true, price: null },
      expected: 200,
    });
    assert(
      r.data.published === true,
      `product ${productId} should be published`,
    );
    assert(
      r.data.agrilinkPrice === null,
      `product ${productId} agrilinkPrice should be null (falls back to sellingPrice)`,
    );
  }
  console.log('2/12 published 2 products with no override price');

  // ── Scenario 3: dealer posts a pepper buy-offer ─────────────────────────
  const buyOffer = await call('/marketplace/manage/buy-offers', {
    token: dealer,
    method: 'POST',
    body: {
      title: `Thu mua tiêu ${stamp}`,
      commodityType: 'pepper',
      unit: 'kg',
      price: 100000,
    },
    expected: 201,
  });
  assert(
    buyOffer.data.commodityType === 'pepper',
    'buy offer commodityType should be pepper',
  );
  assert(buyOffer.data.active === true, 'buy offer should be active');
  console.log('3/12 posted pepper buy-offer');

  // ── Scenario 4: farmer views dealer storefront ──────────────────────────
  const storefront = await call(`/marketplace/dealers/${DEALER_ORG_ID}`, {
    token: farmer,
    expected: 200,
  });
  assert(
    storefront.data.saleOffers.length >= 2,
    'storefront should list at least 2 sale offers',
  );
  for (const offer of storefront.data.saleOffers)
    assert(
      !('stockQuantity' in offer),
      'storefront sale offer must not leak stockQuantity',
    );
  const myPublished = storefront.data.saleOffers.filter((o) =>
    chosenProductIds.includes(o.productId),
  );
  assert(
    myPublished.length === 2,
    'both just-published products should be visible in storefront',
  );
  console.log('4/12 storefront shows sale offers, no stockQuantity leak');

  // ── Scenario 5: farmer places a buy order (2 lines, server-priced) ─────
  const qty = [2, 3];
  const expectedTotal = myPublished.reduce(
    (sum, offer, idx) => sum + Math.round(qty[idx] * offer.price),
    0,
  );
  const buyOrder = await call(`/marketplace/dealers/${DEALER_ORG_ID}/orders`, {
    token: farmer,
    method: 'POST',
    body: {
      kind: 'buy',
      items: myPublished.map((o, idx) => ({
        offerId: o.offerId,
        quantity: qty[idx],
      })),
      fulfillment: 'pickup',
      contactName: `Nông dân QA ${stamp}`,
      contactPhone: '0900000001',
    },
    expected: 201,
  });
  assert(buyOrder.data.status === 'pending', 'new buy order should be pending');
  assert(
    Math.abs(buyOrder.data.estimatedTotal - expectedTotal) < 1,
    `estimatedTotal ${buyOrder.data.estimatedTotal} should equal server-priced total ${expectedTotal} (unitPrice never sent by client)`,
  );
  const buyOrderId = buyOrder.data.id;
  console.log(
    `5/12 buy order placed pending, estimatedTotal=${buyOrder.data.estimatedTotal}`,
  );

  // ── Scenario 6: dealer sees, confirms, matches the order ───────────────
  const pendingList = await call('/agrilink-manage/orders?status=pending', {
    token: dealer,
    expected: 200,
  });
  assert(
    pendingList.data.items.some((i) => i.id === buyOrderId),
    'pending list should contain the new order',
  );
  const confirmed = await call(
    `/agrilink-manage/orders/${buyOrderId}/confirm`,
    {
      token: dealer,
      method: 'POST',
      expected: 201,
    },
  );
  assert(confirmed.data.status === 'confirmed', 'order should be confirmed');
  const match1 = await call(`/agrilink-manage/orders/${buyOrderId}/match`, {
    token: dealer,
    expected: 200,
  });
  assert(
    'linked' in match1.data && 'suggestions' in match1.data,
    'match response should have linked/suggestions',
  );
  console.log('6/12 dealer confirmed order and fetched match suggestions');

  // ── Scenario 7: dealer completes the order (creates debt customer) ─────
  const orderDetail = await call(`/agrilink-manage/orders/${buyOrderId}`, {
    token: dealer,
    expected: 200,
  });
  const editItems = orderDetail.data.items.map((i) => ({
    itemId: i.id,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
  }));
  const completed = await call(
    `/agrilink-manage/orders/${buyOrderId}/complete`,
    {
      token: dealer,
      method: 'POST',
      body: {
        party: { createNew: true },
        paymentMethod: 'debt',
        paidAmount: 0,
        items: editItems,
      },
      expected: 201,
    },
  );
  assert(completed.data.status === 'completed', 'order should be completed');
  assert(
    completed.data.posRef && completed.data.posRef.type === 'order',
    'posRef.type should be order',
  );
  console.log(`7/12 order completed → POS order ${completed.data.posRef.code}`);

  // ── Scenario 8: POS side reflects the AgriLink order (source, debt, stats) ─
  const posOrders = await call('/orders?source=agrilink', {
    token: dealer,
    expected: 200,
  });
  assert(
    posOrders.data.data.some((o) => o.orderCode === completed.data.posRef.code),
    'GET /orders?source=agrilink should contain the linked POS order',
  );
  const matchAfterComplete = await call(
    `/agrilink-manage/orders/${buyOrderId}/match`,
    {
      token: dealer,
      expected: 200,
    },
  );
  assert(
    matchAfterComplete.data.linked,
    'customer link should exist after complete',
  );
  const customerId = matchAfterComplete.data.linked.id;
  const customerDebt = await call(`/debts/customer/${customerId}`, {
    token: dealer,
    expected: 200,
  });
  assert(
    Math.abs(customerDebt.data.totalDebt - completed.data.finalTotal) < 1,
    `customer debt ${customerDebt.data.totalDebt} should equal finalTotal ${completed.data.finalTotal} (paidAmount=0)`,
  );
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const bySource = await call(
    `/orders/stats/by-source?from=${today}&to=${tomorrow}`,
    {
      token: dealer,
      expected: 200,
    },
  );
  const agrilinkStat = bySource.data.find((s) => s.source === 'agrilink');
  assert(
    agrilinkStat && agrilinkStat.orders >= 1,
    'stats/by-source should count >=1 agrilink order today',
  );
  console.log(
    `8/12 POS order visible (source=agrilink), debt=${customerDebt.data.totalDebt}, by-source agrilink orders=${agrilinkStat.orders}`,
  );

  // ── Scenario 9: completing an already-completed order is rejected ──────
  await call(`/agrilink-manage/orders/${buyOrderId}/complete`, {
    token: dealer,
    method: 'POST',
    body: {
      party: { createNew: true },
      paymentMethod: 'debt',
      paidAmount: 0,
      items: editItems,
    },
    expected: 409,
  });
  console.log('9/12 second complete on same order correctly rejected (409)');

  // ── Scenario 10: farmer sell order → weighing slip + farmer debt ───────
  const sellOrder = await call(`/marketplace/dealers/${DEALER_ORG_ID}/orders`, {
    token: farmer,
    method: 'POST',
    body: {
      kind: 'sell',
      items: [{ offerId: buyOffer.data.id, quantity: 80 }],
      fulfillment: 'at_dealer',
      contactName: `Nông dân QA bán ${stamp}`,
      contactPhone: '0900000002',
    },
    expected: 201,
  });
  assert(sellOrder.data.status === 'pending', 'sell order should be pending');
  const sellOrderId = sellOrder.data.id;
  await call(`/agrilink-manage/orders/${sellOrderId}/confirm`, {
    token: dealer,
    method: 'POST',
    expected: 201,
  });
  const sellCompleted = await call(
    `/agrilink-manage/orders/${sellOrderId}/complete`,
    {
      token: dealer,
      method: 'POST',
      body: {
        party: { createNew: true },
        weights: [50, 30],
        pricePerKg: 100000,
        paidAmount: 0,
      },
      expected: 201,
    },
  );
  assert(
    sellCompleted.data.status === 'completed',
    'sell order should be completed',
  );
  assert(
    sellCompleted.data.posRef &&
      sellCompleted.data.posRef.type === 'weighing_slip',
    'posRef.type should be weighing_slip',
  );
  assert(
    sellCompleted.data.finalTotal === 8000000,
    `sell finalTotal should be 8,000,000, got ${sellCompleted.data.finalTotal}`,
  );
  const slips = await call('/weighing-slips?source=agrilink', {
    token: dealer,
    expected: 200,
  });
  assert(
    slips.data.data.some((s) => s.id === sellCompleted.data.posRef.id),
    'GET /weighing-slips?source=agrilink should contain the new slip',
  );
  const sellMatch = await call(`/agrilink-manage/orders/${sellOrderId}/match`, {
    token: dealer,
    expected: 200,
  });
  assert(sellMatch.data.linked, 'farmer link should exist after sell complete');
  const farmerId = sellMatch.data.linked.id;
  // Note: GET /farmer-debts?farmerId= (the list endpoint) is a pre-existing,
  // unrelated defect — see task-10-report.md "Concerns" — so this uses the
  // working GET /farmer-debts/farmer/:farmerId aggregate instead, which is
  // part of the same farmer-debts contract and returns the same remaining
  // total.
  const farmerDebt = await call(`/farmer-debts/farmer/${farmerId}`, {
    token: dealer,
    expected: 200,
  });
  assert(
    farmerDebt.data.totalDebt === 8000000,
    `farmer debt remaining should be 8,000,000, got ${farmerDebt.data.totalDebt}`,
  );
  console.log(
    '10/12 sell order completed → weighing slip + farmer debt 8,000,000 remaining',
  );

  // ── Scenario 11: RLS isolation — a different org cannot see this order ─
  await call(`/agrilink-manage/orders/${buyOrderId}`, {
    token: legacyOwner,
    expected: 404,
  });
  console.log(
    '11/12 RLS: legacy-org owner (dtd2x) cannot see dealer-demo order (404)',
  );

  // ── Scenario 12: buyer cancels a pending order; dealer confirm then 409 ─
  const secondOrder = await call(
    `/marketplace/dealers/${DEALER_ORG_ID}/orders`,
    {
      token: farmer,
      method: 'POST',
      body: {
        kind: 'buy',
        items: [{ offerId: myPublished[0].offerId, quantity: 1 }],
        fulfillment: 'pickup',
        contactName: `Nông dân QA huỷ ${stamp}`,
        contactPhone: '0900000003',
      },
      expected: 201,
    },
  );
  const cancelled = await call(
    `/marketplace/my-orders/${secondOrder.data.id}/cancel`,
    {
      token: farmer,
      method: 'POST',
      body: {},
      expected: 201,
    },
  );
  assert(
    cancelled.data.status === 'cancelled',
    'buyer-cancelled order should be cancelled',
  );
  await call(`/agrilink-manage/orders/${secondOrder.data.id}/confirm`, {
    token: dealer,
    method: 'POST',
    expected: 409,
  });
  console.log(
    '12/12 buyer cancel → cancelled; dealer confirm on cancelled order correctly rejected (409)',
  );

  console.log('AgriLink orders smoke passed');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
