import { describe, expect, it } from 'vitest';
import { priceChange, pricesUpdatedLabel, firstWithData, pricesDate, regionDateNote } from './marketPrices';

describe('priceChange', () => {
  it('shows direction and amount like the mockup', () => {
    expect(priceChange(500)).toEqual({ text: '▲ 500', tone: 'up' });
    expect(priceChange(-700)).toEqual({ text: '▼ 700', tone: 'down' });
    expect(priceChange(0)).toEqual({ text: '— 0', tone: 'flat' });
  });

  it('formats thousands the Vietnamese way', () => {
    expect(priceChange(1500)).toEqual({ text: '▲ 1.500', tone: 'up' });
  });

  it('shows nothing when there is no previous price', () => {
    expect(priceChange(null)).toBeNull();
  });
});

describe('pricesUpdatedLabel', () => {
  const now = new Date('2026-09-29T10:00:00Z'); // 17:00 giờ VN

  it('says "hôm nay" for a Vietnam-time same-day update', () => {
    expect(pricesUpdatedLabel('2026-09-29T07:30:00Z', now)).toBe('Cập nhật 14:30 hôm nay');
  });

  it('adds the date for older updates', () => {
    expect(pricesUpdatedLabel('2026-09-28T00:00:00Z', now)).toBe('Cập nhật 07:00 28/09');
  });

  it('handles a missing time', () => {
    expect(pricesUpdatedLabel(null, now)).toBe('Chưa có dữ liệu');
  });
});

describe('firstWithData', () => {
  it('opens the first commodity that has prices', () => {
    const list = [
      { key: 'coffee' as const, regions: [] },
      { key: 'pepper' as const, regions: [{ name: 'Đắk Lắk', price: 1, change: null, recordedAt: '' }] },
    ];
    expect(firstWithData(list)).toBe('pepper');
    expect(firstWithData([{ key: 'coffee' as const, regions: [] }])).toBe('coffee');
  });
});

describe('pricesDate', () => {
  const region = (recordedAt: string) => ({ name: 'x', price: 1, change: null, recordedAt });

  it('is the newest price day as dd/mm', () => {
    expect(pricesDate([region('2026-09-26'), region('2026-09-29')])).toBe('29/09');
  });

  it('is empty without prices', () => {
    expect(pricesDate([])).toBe('');
  });
});

describe('regionDateNote', () => {
  it('marks a province whose price is older than the newest one', () => {
    expect(regionDateNote('2026-09-26', '29/09')).toBe('26/09');
    expect(regionDateNote('2026-09-29', '29/09')).toBe('');
  });
});
