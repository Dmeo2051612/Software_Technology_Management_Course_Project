import { describe, expect, it } from 'vitest';
import { fulfillmentLabel, statusBadges } from './labels';

describe('AgriLink labels', () => {
  it.each([
    ['sell', 'delivery', 'Đại lý đến lấy tại vườn'],
    ['sell', 'at_dealer', 'Nông dân mang đến đại lý'],
    ['buy', 'delivery', 'Đại lý giao tận nơi'],
    ['buy', 'pickup', 'Tự đến đại lý lấy'],
  ] as const)('labels %s %s from the intent side', (side, fulfillment, expected) => {
    expect(fulfillmentLabel(side, fulfillment)).toBe(expected);
  });

  it('does not style cancelled and rejected orders as success', () => {
    expect(statusBadges.cancelled).toBe('agrilink-status-cancelled');
    expect(statusBadges.rejected).toBe('bg-danger');
    expect(statusBadges.completed).toBe('bg-success');
  });
});
