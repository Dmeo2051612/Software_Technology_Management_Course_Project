import {
  nextSession,
  productTokens,
  scoreCandidates,
  type Candidate,
  type IntentForMatch,
  type Service,
} from './scoring';

const now = new Date('2026-09-28T03:00:00Z');
const intent: IntentForMatch = {
  requesterId: 'farmer',
  side: 'sell',
  cropId: 'coffee',
  productQuery: null,
  quantityKg: 5000,
  provinceCode: 'dak-lak',
  windowStart: '2026-09-28',
  windowEnd: '2026-10-04',
  fulfillmentPref: 'any',
  lat: 12.7,
  lng: 108,
};
const pickup: Service = {
  active: true,
  cropIds: ['coffee'],
  areaMode: 'provinces',
  radiusKm: null,
  provinceCodes: ['dak-lak'],
  feeMode: 'per_kg',
  feeAmount: 400,
  minQuantityKg: 0,
  leadTimeHours: 12,
  windows: [{ weekday: 4, session: 'morning' }],
};
const candidate = (id: string, price: number, p?: Service): Candidate => ({
  dealer: { id, name: id, logoUrl: null, provinceName: 'Đắk Lắk' },
  lat: 12.7,
  lng: 108,
  completedOrders: 0,
  offer: { offerId: id, price, unit: 'kg', maxQuantityKg: null },
  pickup: p,
});
describe('live match scoring', () => {
  it('balances price and pickup, including capacity', () => {
    const rows = scoreCandidates(
      intent,
      [candidate('high', 22000), candidate('pickup', 21000, pickup)],
      now,
    );
    expect(rows[0].dealer.id).toBe('pickup');
    const limited = candidate('limited', 23000);
    limited.offer!.maxQuantityKg = 3000;
    expect(
      scoreCandidates(intent, [limited, candidate('normal', 22000)], now).find(
        (x) => x.dealer.id === 'limited',
      )?.score,
    ).toBeLessThan(100);
  });
  it('filters own organization and prefers pickup when requested', () => {
    const i = {
      ...intent,
      ownOrganizationIds: ['own'],
      fulfillmentPref: 'pickup' as const,
    };
    expect(
      scoreCandidates(
        i,
        [
          candidate('own', 99999, pickup),
          candidate('remote', 30000),
          candidate('farm', 20000, pickup),
        ],
        now,
      ).map((x) => x.dealer.id),
    ).toEqual(['farm']);
  });
  it('honors session lead time', () => {
    const s = { ...pickup, leadTimeHours: 80 };
    expect(nextSession(s, intent, now)).toBeNull();
    expect(nextSession(pickup, intent, now)).toEqual({
      date: '2026-10-01',
      session: 'morning',
    });
  });
  it('matches buy product tokens and stock', () => {
    const i = {
      ...intent,
      side: 'buy' as const,
      productQuery: 'phân NPK 16-16-8',
    };
    const c = candidate('seller', 0);
    c.products = [
      {
        offerId: 'p',
        name: 'Phân NPK 16-16-8',
        unit: 'bao',
        price: 300000,
        inStock: true,
      },
      {
        offerId: 'q',
        name: 'Thuốc sâu',
        unit: 'chai',
        price: 100000,
        inStock: false,
      },
    ];
    expect(productTokens(i.productQuery)).toContain('npk');
    expect(scoreCandidates(i, [c], now)[0].products).toHaveLength(1);
  });
  it('gives buy delivery full, half, or no convenience credit', () => {
    const i = { ...intent, side: 'buy' as const, productQuery: 'phân NPK' };
    const make = (id: string, delivery: Service) => {
      const c = candidate(id, 0);
      c.products = [
        { offerId: id, name: 'Phân NPK', unit: 'bao', price: 1, inStock: true },
      ];
      c.delivery = delivery;
      return c;
    };
    const rows = scoreCandidates(
      i,
      [
        make('session', pickup),
        make('no-session', { ...pickup, windows: [] }),
        make('no-coverage', { ...pickup, provinceCodes: [] }),
      ],
      now,
    );
    expect(rows.map((c) => [c.dealer.id, c.score])).toEqual([
      ['session', 85],
      ['no-session', 75],
      ['no-coverage', 65],
    ]);
  });
});
