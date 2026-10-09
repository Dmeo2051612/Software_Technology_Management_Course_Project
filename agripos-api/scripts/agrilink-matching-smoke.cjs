/** Local end-to-end check for the Part 3 offer, booking and completion flow. */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const base =
  process.env.SMOKE_BASE_URL ||
  `http://127.0.0.1:${process.env.APP_PORT || 3000}/api/v1`;
const dealerId = '00000000-0000-4000-8000-000000000002';
const alternateDealerId = '00000000-0000-4000-8000-000000000001';
const stamp = Date.now();
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const formatDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

async function call(
  path,
  { token, method = 'GET', body, expected = 200 } = {},
) {
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
    throw new Error(
      `${method} ${path}: HTTP ${response.status}: ${JSON.stringify(payload)}`,
    );
  return payload.data;
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
  const db = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  await db.connect();
  try {
    let date;
    for (let offset = 3; offset <= 60; offset++) {
      const candidate = formatDate.format(
        new Date(Date.now() + offset * 86400000),
      );
      const { rows } = await db.query(
        `SELECT count(*)::int AS used FROM agrilink_service_bookings b
         WHERE b.organization_id=$1 AND b.booking_date=$2::date AND b.session='afternoon' AND b.status='active'`,
        [dealerId, candidate],
      );
      if (!rows[0].used) {
        date = candidate;
        break;
      }
    }
    assert(date, 'No free smoke date within the intent window.');
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const crop = (
      await db.query(
        "SELECT id FROM agri_crops WHERE code='sau-rieng' AND active LIMIT 1",
      )
    ).rows[0];
    assert(crop, 'The sầu riêng seed crop is required.');
    const dealer = await login('dealer-demo@agrilink.vn');
    const farmer = await login('farmer-demo@agrilink.vn');
    const adminUser = (await db.query('SELECT id FROM users WHERE email=$1', ['moderator@agrilink.vn'])).rows[0];
    assert(adminUser, 'Local moderator account is required.');
    const role = (await db.query('SELECT role FROM agrilink_platform_roles WHERE user_id=$1', [adminUser.id])).rows[0]?.role;
    if (role !== 'admin') {
      await db.query(`INSERT INTO agrilink_platform_roles(user_id,role) VALUES($1,'admin') ON CONFLICT(user_id) DO UPDATE SET role='admin'`, [adminUser.id]);
      console.log('Local smoke granted moderator@agrilink.vn the platform admin role.');
    }
    const admin = await login('moderator@agrilink.vn');
    await call('/marketplace/manage/profile', {
      token: dealer,
      method: 'PATCH',
      body: {
        marketplaceEnabled: true,
        provinceCode: 'dak-lak',
        lat: 12.7,
        lng: 108.05,
      },
    });
    const buyOffer = await call('/marketplace/manage/buy-offers', {
      token: dealer,
      method: 'POST',
      body: {
        title: `Sầu riêng Part 3 ${stamp}`,
        cropId: crop.id,
        unit: 'kg',
        price: 60000,
      },
      expected: 201,
    });
    assert(
      buyOffer.cropId === crop.id && buyOffer.commodityType == null,
      'Expected crop-only buy offer.',
    );
    await db.query(`UPDATE agrilink_offers SET price_updated_at=now()-interval '48 hours' WHERE id=$1`, [buyOffer.id]);
    const staleStorefront = await call(`/marketplace/dealers/${dealerId}`, { token: farmer });
    assert(!staleStorefront.buyOffers.some(o => o.offerId === buyOffer.id), 'Stale offer remained public.');
    await call(`/marketplace/dealers/${dealerId}/orders`, { token: farmer, method: 'POST', expected: 400,
      body: { kind: 'sell', fulfillment: 'at_dealer', contactName: 'Nông dân thử nghiệm', contactPhone: '0900000001', items: [{ offerId: buyOffer.id, quantity: 80 }] } });
    const confirmedOffer = await call(`/marketplace/manage/buy-offers/${buyOffer.id}/confirm-price`, { token: dealer, method: 'POST', expected: 201 });
    assert(!confirmedOffer.stale, 'Confirmed offer is still stale.');
    const freshStorefront = await call(`/marketplace/dealers/${dealerId}`, { token: farmer });
    assert(freshStorefront.buyOffers.some(o => o.offerId === buyOffer.id), 'Confirmed offer not public.');
    const serviceBody = {
      active: true,
      cropIds: [crop.id],
      areaMode: 'provinces',
      provinceCodes: ['dak-lak'],
      feeMode: 'free',
      feeAmount: 0,
      minQuantityKg: 0,
      leadTimeHours: 0,
      note: '',
      windows: [{ weekday, session: 'afternoon', capacity: 1 }],
    };
    await call('/marketplace/manage/services/farm_pickup', {
      token: dealer,
      method: 'PUT',
      body: serviceBody,
    });
    const slots = await call(
      `/marketplace/dealers/${dealerId}/availability?kind=farm_pickup&from=${date}&to=${date}`,
      {},
    );
    assert(
      slots.some((s) => s.session === 'afternoon' && s.remaining === 1),
      'Expected one available slot.',
    );
    async function intent(fulfillmentPref = 'pickup') {
      const result = await call('/marketplace/intents', {
        token: farmer,
        method: 'POST',
        body: {
          rawText: `Bán 80 kg sầu riêng ${stamp}`,
          side: 'sell',
          cropId: crop.id,
          quantityKg: 80,
          provinceCode: 'dak-lak',
          windowStart: date,
          windowEnd: date,
          fulfillmentPref,
        },
        expected: 201,
      });
      return result.intent.id;
    }
    const intentId = await intent();
    const leadRows = await call('/marketplace/manage/leads?side=sell', {
      token: dealer,
    });
    assert(
      leadRows.some((lead) => lead.intentId === intentId),
      'Dealer must receive anonymised lead.',
    );
    assert(
      !JSON.stringify(
        leadRows.find((lead) => lead.intentId === intentId),
      ).includes('contactPhone'),
      'Lead exposed farmer contact.',
    );
    const offer = await call(`/marketplace/manage/leads/${intentId}/offers`, {
      token: dealer,
      method: 'POST',
      body: {
        pricePerKg: 65000,
        fulfillment: 'delivery',
        scheduledDate: date,
        scheduledSession: 'afternoon',
        feePerKg: 0,
        message: 'Có thể đến vườn',
      },
      expected: 201,
    });
    const detail = await call(`/marketplace/my-intents/${intentId}`, {
      token: farmer,
    });
    assert(
      detail.offers.some((o) => o.id === offer.id && o.scheduledDate === date),
      'Farmer cannot see offer.',
    );
    const accepted = await call(
      `/marketplace/my-intents/${intentId}/offers/${offer.id}/accept`,
      {
        token: farmer,
        method: 'POST',
        body: {
          contactName: 'Nông dân thử nghiệm',
          contactPhone: '0900000001',
          address: 'Đắk Lắk',
        },
        expected: 201,
      },
    );
    assert(accepted.intent.status === 'matched', 'Intent not matched.');
    assert(!('lat' in accepted.intent) && !('lng' in accepted.intent) &&
      accepted.intent.windowStart === date && accepted.intent.windowEnd === date,
      'Accepted intent must use the public detail shape.');
    assert(
      accepted.order.status === 'pending' &&
        accepted.order.intentId === intentId &&
        accepted.order.scheduledDate === date &&
        accepted.order.scheduledSession === 'afternoon',
      'Order missing intent or slot.',
    );
    assert(
      accepted.order.items[0].unitPrice === 65000 &&
        accepted.order.items[0].cropId === crop.id,
      'Accepted offer price or crop missing.',
    );
    const orderId = accepted.order.id;
    let booking = (
      await db.query(
        'SELECT status FROM agrilink_service_bookings WHERE agrilink_order_id=$1',
        [orderId],
      )
    ).rows[0];
    assert(booking?.status === 'active', 'Booking missing.');
    const chooseBody = {
      organizationId: dealerId,
      fulfillment: 'delivery',
      scheduledDate: date,
      scheduledSession: 'afternoon',
      contactName: 'Nông dân thử nghiệm',
      contactPhone: '0900000001',
      address: 'Đắk Lắk',
    };
    const secondIntentId = await intent();
    await call(`/marketplace/my-intents/${secondIntentId}/choose`, {
      token: farmer,
      method: 'POST',
      body: chooseBody,
      expected: 409,
    });
    await call(`/agrilink-manage/orders/${orderId}/confirm`, {
      token: dealer,
      method: 'POST',
      expected: 201,
    });
    const completed = await call(
      `/agrilink-manage/orders/${orderId}/complete`,
      {
        token: dealer,
        method: 'POST',
        body: {
          party: { createNew: true },
          weights: [50, 30],
          pricePerKg: 65000,
          paidAmount: 0,
        },
        expected: 201,
      },
    );
    assert(
      completed.status === 'completed' &&
        completed.finalTotal === 5200000 &&
        !completed.posRef,
      'Non-commodity completion must finish without slip.',
    );
    const rated = await call(`/marketplace/my-orders/${orderId}/rating`, { token: farmer, method: 'POST', expected: 201,
      body: { stars: 5, accurateWeight: true, paidOnTime: true, onTime: true, comment: 'Đúng hẹn' } });
    assert(rated.stars === 5, 'Farmer rating failed.');
    const ratedStorefront = await call(`/marketplace/dealers/${dealerId}`, { token: farmer });
    assert(ratedStorefront.dealer.ratings.count >= 1, 'Storefront rating aggregate missing.');
    const publicRatings = await call(`/marketplace/dealers/${dealerId}/ratings`, { token: farmer });
    assert(publicRatings.items.some(r => r.stars === 5 && !/farmer-demo|0900000001|farmer-1/i.test(JSON.stringify(r))), 'Public rating missing or exposed farmer identity.');
    const managedRatings = await call('/marketplace/manage/ratings', { token: dealer });
    const ratingId = managedRatings.items.find(r => r.orderId === orderId)?.id;
    assert(ratingId, 'Dealer rating record missing.');
    await call(`/platform/agrilink/ratings/${ratingId}/hide`, { token: admin, method: 'POST', expected: 201, body: { reason: 'Smoke moderation' } });
    assert((await call(`/marketplace/dealers/${dealerId}/ratings`, { token: farmer })).aggregates.count === ratedStorefront.dealer.ratings.count - 1, 'Hidden rating affected public aggregates incorrectly.');
    await call(`/platform/agrilink/ratings/${ratingId}/unhide`, { token: admin, method: 'POST', expected: 201 });
    const ratedMatches = await call(`/marketplace/my-intents/${secondIntentId}`, { token: farmer });
    assert(ratedMatches.matches.some(m => m.dealer.id === dealerId && m.reliability.ratingCount >= 1), 'Match rating aggregate missing.');
    const currentVerification = await call('/marketplace/manage/verification', { token: dealer });
    if (!currentVerification || currentVerification.status === 'rejected')
      await call('/marketplace/manage/verification', { token: dealer, method: 'POST', expected: 201,
        body: { legalName: 'Đại lý AgriLink Demo', taxCode: '0123456789', businessAddress: 'Đắk Lắk' } });
    if (currentVerification?.status !== 'verified')
      await call(`/platform/agrilink/verifications/${dealerId}/approve`, { token: admin, method: 'POST', expected: 201, body: {} });
    const verifiedStorefront = await call(`/marketplace/dealers/${dealerId}`, { token: farmer });
    assert(verifiedStorefront.dealer.verified === true, 'Verified dealer flag missing.');
    booking = (
      await db.query(
        'SELECT status FROM agrilink_service_bookings WHERE agrilink_order_id=$1',
        [orderId],
      )
    ).rows[0];
    assert(booking.status === 'active', 'Completion cancelled booking.');
    await call('/marketplace/manage/services/farm_pickup', {
      token: dealer,
      method: 'PUT',
      body: {
        ...serviceBody,
        windows: [{ weekday, session: 'afternoon', capacity: 2 }],
      },
    });
    const buyerCancelIntent = await intent();
    const buyerCancelOrder = await call(
      `/marketplace/my-intents/${buyerCancelIntent}/choose`,
      {
        token: farmer,
        method: 'POST',
        body: chooseBody,
        expected: 201,
      },
    );
    await call(`/marketplace/my-orders/${buyerCancelOrder.order.id}/cancel`, {
      token: farmer,
      method: 'POST',
      body: {},
      expected: 201,
    });
    const buyerBooking = (
      await db.query(
        'SELECT status FROM agrilink_service_bookings WHERE agrilink_order_id=$1',
        [buyerCancelOrder.order.id],
      )
    ).rows[0];
    assert(
      buyerBooking?.status === 'cancelled',
      'Buyer cancellation did not release booking.',
    );
    const buyerIntent = await call(`/marketplace/my-intents/${buyerCancelIntent}`, { token: farmer });
    assert(buyerIntent.intent.status === 'open', 'Buyer cancellation did not reopen intent.');
    const dealerRejectIntent = await intent('any');
    const rejectOffer = await call(`/marketplace/manage/leads/${dealerRejectIntent}/offers`, {
      token: dealer,
      method: 'POST',
      body: {
        pricePerKg: 65000,
        fulfillment: 'delivery',
        scheduledDate: date,
        scheduledSession: 'afternoon',
      },
      expected: 201,
    });
    const dealerRejectOrder = await call(
      `/marketplace/my-intents/${dealerRejectIntent}/offers/${rejectOffer.id}/accept`,
      {
        token: farmer,
        method: 'POST',
        body: { contactName: chooseBody.contactName, contactPhone: chooseBody.contactPhone, address: chooseBody.address },
        expected: 201,
      },
    );
    await call(`/agrilink-manage/orders/${dealerRejectOrder.order.id}/reject`, {
      token: dealer,
      method: 'POST',
      body: { reason: 'Không thể thu mua' },
      expected: 201,
    });
    const dealerBooking = (
      await db.query(
        'SELECT status FROM agrilink_service_bookings WHERE agrilink_order_id=$1',
        [dealerRejectOrder.order.id],
      )
    ).rows[0];
    assert(
      dealerBooking?.status === 'cancelled',
      'Dealer rejection did not release booking under RLS.',
    );
    const reopened = await call(`/marketplace/my-intents/${dealerRejectIntent}`, { token: farmer });
    assert(reopened.intent.status === 'open', 'Dealer rejection did not reopen intent under RLS.');
    const offerStatus = (await db.query('SELECT status FROM agrilink_intent_offers WHERE id=$1', [rejectOffer.id])).rows[0]?.status;
    assert(offerStatus === 'expired', 'Rejected order left its accepted offer active.');
    await db.query(
      `INSERT INTO agrilink_offers(organization_id,kind,title,crop_id,unit,price,active)
       VALUES($1,'buy',$2,$3,'kg',61000,true)`,
      [alternateDealerId, `Sầu riêng smoke ${stamp}`, crop.id],
    );
    const alternate = await call(`/marketplace/my-intents/${dealerRejectIntent}/choose`, {
      token: farmer,
      method: 'POST',
      body: { organizationId: alternateDealerId, fulfillment: 'at_dealer',
        contactName: chooseBody.contactName, contactPhone: chooseBody.contactPhone },
      expected: 201,
    });
    assert(alternate.intent.status === 'matched' && alternate.order.dealer.id === alternateDealerId,
      'Farmer could not choose another dealer after rejection.');
    await db.query('UPDATE agrilink_offers SET active=false WHERE organization_id=$1 AND title=$2',
      [alternateDealerId, `Sầu riêng smoke ${stamp}`]);
    console.log(
      'AgriLink matching and trust smoke passed: stale/confirm, offer, accept, completion, rating, verification, cancellation and RLS reopening.',
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
