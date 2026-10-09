import { ConflictException, ForbiddenException } from '@nestjs/common';
import { nextStatus } from './order-state';

const dealer = (role = 'owner') => ({ side: 'dealer' as const, role });
const buyer = { side: 'buyer' as const };
const o = (status: any, fulfillment: any = 'pickup') => ({
  status,
  fulfillment,
});

describe('nextStatus', () => {
  it.each([
    ['pending', 'confirm', 'confirmed'],
    ['pending', 'reject', 'rejected'],
    ['confirmed', 'complete', 'completed'],
    ['confirmed', 'cancel', 'cancelled'],
    ['pending', 'editItems', 'pending'],
    ['confirmed', 'editItems', 'confirmed'],
  ])('dealer %s --%s--> %s', (from, action, to) => {
    expect(nextStatus(o(from), action as any, dealer())).toBe(to);
  });

  it('deliver only for delivery orders', () => {
    expect(nextStatus(o('confirmed', 'delivery'), 'deliver', dealer())).toBe(
      'delivering',
    );
    expect(() =>
      nextStatus(o('confirmed', 'pickup'), 'deliver', dealer()),
    ).toThrow(ConflictException);
  });

  it('delivering can complete or be cancelled by dealer', () => {
    expect(nextStatus(o('delivering', 'delivery'), 'complete', dealer())).toBe(
      'completed',
    );
    expect(nextStatus(o('delivering', 'delivery'), 'cancel', dealer())).toBe(
      'cancelled',
    );
  });

  it('buyer may cancel only pending/confirmed', () => {
    expect(nextStatus(o('pending'), 'cancel', buyer)).toBe('cancelled');
    expect(nextStatus(o('confirmed'), 'cancel', buyer)).toBe('cancelled');
    expect(() =>
      nextStatus(o('delivering', 'delivery'), 'cancel', buyer),
    ).toThrow(ConflictException);
  });

  it('dealer cannot cancel a pending order (must reject)', () => {
    expect(() => nextStatus(o('pending'), 'cancel', dealer())).toThrow(
      ConflictException,
    );
  });

  it('buyer cannot perform dealer actions', () => {
    expect(() => nextStatus(o('pending'), 'confirm', buyer)).toThrow(
      ForbiddenException,
    );
  });

  it('cashier may complete only non-delivery orders and nothing else', () => {
    expect(
      nextStatus(o('confirmed', 'pickup'), 'complete', dealer('cashier')),
    ).toBe('completed');
    expect(() =>
      nextStatus(o('delivering', 'delivery'), 'complete', dealer('cashier')),
    ).toThrow(ForbiddenException);
    expect(() =>
      nextStatus(o('pending'), 'confirm', dealer('cashier')),
    ).toThrow(ForbiddenException);
  });

  it.each(['completed', 'rejected', 'cancelled'])('%s is terminal', (s) => {
    for (const a of [
      'confirm',
      'reject',
      'deliver',
      'complete',
      'cancel',
      'editItems',
    ])
      expect(() => nextStatus(o(s, 'delivery'), a as any, dealer())).toThrow(
        ConflictException,
      );
  });
});
