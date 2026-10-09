import { AgrilinkMatchingService } from './agrilink-matching.service';

const dealer = {
  id: 'dealer-user',
  role: 'owner',
  organizationId: 'org-1',
  memberships: [{ id: 'org-1' }],
} as any;
const farmer = {
  id: 'farmer-1',
  role: 'farmer',
  organizationId: null,
  memberships: [],
} as any;
const baseIntent = {
  id: 'intent-1',
  requesterId: 'farmer-1',
  status: 'open',
  side: 'sell',
  cropId: 'crop-1',
  quantityKg: 80,
  windowStart: '2026-10-05',
  windowEnd: '2026-10-05',
  lat: 12.7,
  lng: 108.05,
};
const match = {
  dealer: { id: 'org-1' },
  offer: { offerId: 'buy-1' },
  pickup: { available: true },
};

function setup() {
  const intent = { ...baseIntent };
  const calls: Array<[string, unknown[]]> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    if (sql.includes('SELECT id,status FROM agrilink_intents'))
      return [{ id: intent.id, status: intent.status }];
    if (sql.includes('SELECT status FROM agrilink_intents'))
      return [{ status: intent.status }];
    if (sql.includes('SELECT id,status FROM agrilink_intent_offers'))
      return [{ id: 'offer-1', status: 'pending' }];
    if (sql.includes('FROM agrilink_intent_offers WHERE id='))
      return [
        {
          organizationId: 'org-1',
          status: 'pending',
          pricePerKg: 65000,
          products: null,
          fulfillment: 'at_dealer',
          scheduledDate: null,
          scheduledSession: null,
        },
      ];
    if (sql.includes('INSERT INTO agrilink_intent_offers'))
      return [{ id: 'offer-1', status: 'pending' }];
    if (sql.includes("UPDATE agrilink_intents SET status='matched'"))
      intent.status = 'matched';
    return [];
  });
  const db = { query, transaction: jest.fn((cb: any) => cb({ query })) } as any;
  const intents = {
    findForMatching: jest.fn(async () => intent),
    matches: jest.fn(async () => [match]),
    publicIntent: jest.fn((r: any) => {
      const { lat, lng, ...publicRow } = r;
      return publicRow;
    }),
  } as any;
  const marketplace = {
    placeOrderTx: jest.fn(async () => 'order-1'),
    myOrder: jest.fn(async () => ({
      id: 'order-1',
      intentId: intent.id,
      status: 'pending',
    })),
  } as any;
  return {
    service: new AgrilinkMatchingService(db, intents, marketplace),
    db,
    intents,
    marketplace,
    calls,
  };
}

describe('intent offers and order matching', () => {
  it('reuses placeOrderTx for choose and stores the intent on the order', async () => {
    const { service, marketplace, calls } = setup();
    const result = await service.choose(farmer, 'intent-1', {
      organizationId: 'org-1',
      fulfillment: 'at_dealer',
      contactName: 'Farmer',
      contactPhone: '0900000001',
    });
    expect(result.intent.status).toBe('matched');
    expect(result.intent).not.toHaveProperty('lat');
    expect(result.intent).not.toHaveProperty('lng');
    expect(marketplace.placeOrderTx).toHaveBeenCalledWith(
      expect.anything(),
      farmer,
      'org-1',
      expect.objectContaining({
        kind: 'sell',
        items: [{ offerId: 'buy-1', quantity: 80 }],
      }),
      expect.objectContaining({ intentId: 'intent-1', cropId: 'crop-1' }),
    );
    expect(
      calls.some(([sql]) =>
        sql.includes("status=CASE WHEN id=$2 THEN 'accepted' ELSE 'expired'"),
      ),
    ).toBe(true);
  });

  it('accepts a pending dealer price and records an accepted offer notification', async () => {
    const { service, marketplace, calls } = setup();
    const result = await service.accept(farmer, 'intent-1', 'offer-1', {
      contactName: 'Farmer',
      contactPhone: '0900000001',
    });
    expect(
      marketplace.placeOrderTx.mock.calls[0][4].pricesOverride.get('buy-1'),
    ).toBe(65000);
    expect(result.intent).not.toHaveProperty('lat');
    expect(result.intent).not.toHaveProperty('lng');
    expect(
      calls.some(
        ([sql, params]) =>
          sql.includes("'agrilink_offer_status'") &&
          params.includes('agrilink-offer:offer-1:accepted'),
      ),
    ).toBe(true);
  });

  it('rejects an open intent after its VN window ends', async () => {
    const { service, intents } = setup();
    intents.findForMatching.mockResolvedValue({ ...baseIntent, windowEnd: '2000-01-01' });
    await expect(service.choose(farmer, 'intent-1', {
      organizationId: 'org-1', fulfillment: 'at_dealer',
      contactName: 'Farmer', contactPhone: '0900000001',
    })).rejects.toMatchObject({ status: 409, response: { message: 'Tin đã hết hạn.' } });
  });

  it('requires an eligible lead and rejects a second pending offer', async () => {
    const { service, intents, db } = setup();
    intents.matches.mockResolvedValueOnce([]);
    await expect(
      service.createOffer(dealer, 'intent-1', {
        pricePerKg: 65000,
        fulfillment: 'at_dealer',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const original = db.query.getMockImplementation();
    db.query.mockImplementation((sql: string, params: unknown[]) =>
      sql.includes('INSERT INTO agrilink_intent_offers')
        ? Promise.reject(
            Object.assign(new Error('duplicate'), { code: '23505' }),
          )
        : original(sql, params),
    );
    await expect(
      service.createOffer(dealer, 'intent-1', {
        pricePerKg: 65000,
        fulfillment: 'at_dealer',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('notifies the farmer of a new offer without exposing farmer details to the dealer', async () => {
    const { service, calls } = setup();
    const offer = await service.createOffer(dealer, 'intent-1', {
      pricePerKg: 65000,
      fulfillment: 'at_dealer',
    });
    expect(offer.id).toBe('offer-1');
    expect(
      calls.some(
        ([sql, params]) =>
          sql.includes("'agrilink_offer'") && params.includes('farmer-1'),
      ),
    ).toBe(true);
    const dealerOffers = await service.leadOffers(dealer);
    expect(JSON.stringify(dealerOffers)).not.toContain('farmer-1');
  });
});
