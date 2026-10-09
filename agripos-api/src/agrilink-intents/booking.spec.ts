import {
  bookable,
  calendarDate,
  lockSlot,
  serviceSlots,
  validDate,
} from './booking';
import { nextSession, Service } from './scoring';

describe('service booking availability', () => {
  const service = {
    active: true,
    cropIds: [],
    areaMode: 'provinces',
    radiusKm: null,
    provinceCodes: ['dak-lak'],
    feeMode: 'free',
    feeAmount: 0,
    minQuantityKg: 0,
    leadTimeHours: 0,
    windows: [
      { weekday: 1, session: 'morning', capacity: 1 },
      { weekday: 1, session: 'afternoon', capacity: 2 },
    ],
    bookings: [{ date: '2026-10-05', session: 'morning', used: 1 }],
  } as Service;
  const intent = {
    requesterId: 'farmer',
    side: 'sell',
    cropId: 'crop',
    productQuery: null,
    quantityKg: 80,
    provinceCode: 'dak-lak',
    windowStart: '2026-10-05',
    windowEnd: '2026-10-05',
    fulfillmentPref: 'pickup',
    lat: null,
    lng: null,
  } as const;

  it('validates calendar dates, capacity and lead time, and skips a full session', () => {
    expect(validDate('2026-02-30')).toBe(false);
    expect(calendarDate(new Date('2026-10-04T17:00:00Z'))).toBe('2026-10-05');
    expect(
      bookable('2026-10-05', 'morning', 24, new Date('2026-10-04T01:00:00Z')),
    ).toBe(false);
    expect(
      nextSession(service, intent, new Date('2026-10-04T00:00:00Z')),
    ).toEqual({ date: '2026-10-05', session: 'afternoon' });
  });

  it('returns only slots with remaining capacity within 14 days', async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes('s.id,s.lead_time_hours')
        ? [{ id: 'service-1', lead_time_hours: 0 }]
        : [
            { date: '2026-10-05', session: 'morning', remaining: 0 },
            { date: '2026-10-05', session: 'afternoon', remaining: 1 },
          ],
    );
    expect(
      await serviceSlots(
        query,
        'dealer',
        'farm_pickup',
        '2026-10-05',
        '2026-10-05',
      ),
    ).toEqual([{ date: '2026-10-05', session: 'afternoon', remaining: 1 }]);
    await expect(
      serviceSlots(query, 'dealer', 'farm_pickup', '2026-10-05', '2026-10-19'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('locks the service before rechecking the final seat', async () => {
    let used = 0;
    const calls: string[] = [];
    const em = {
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        return sql.includes('FOR UPDATE')
          ? [{ id: 'service-1', lead_time_hours: 0 }]
          : [{ capacity: 1, used: used++ }];
      }),
    } as any;
    expect(
      await lockSlot(em, 'dealer', 'farm_pickup', '2026-10-05', 'afternoon'),
    ).toBe('service-1');
    await expect(
      lockSlot(em, 'dealer', 'farm_pickup', '2026-10-05', 'afternoon'),
    ).rejects.toMatchObject({
      status: 409,
      response: { message: 'Buổi này đã hết chỗ' },
    });
    expect(calls[0]).toContain('FOR UPDATE');
    expect(calls[1]).toContain('count(*)');
  });
});
