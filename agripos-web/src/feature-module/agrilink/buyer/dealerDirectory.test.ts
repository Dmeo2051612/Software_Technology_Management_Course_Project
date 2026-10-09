import { describe, expect, it } from 'vitest';
import type { DealerCard } from '../../../services/agrilink.types';
import { mergeCropTags } from './dealerDirectory';

const dealer = (crops: { code: string; name: string }[]) => ({ crops }) as DealerCard;

describe('mergeCropTags', () => {
  it('keeps earlier options, adds new crops once and sorts by Vietnamese name', () => {
    const merged = mergeCropTags(
      [{ code: 'sau-rieng', name: 'Sầu riêng' }],
      [dealer([{ code: 'ho-tieu', name: 'Hồ tiêu' }]), dealer([{ code: 'ca-phe-nhan', name: 'Cà phê nhân' }, { code: 'ho-tieu', name: 'Hồ tiêu' }])],
    );
    expect(merged.map((tag) => tag.name)).toEqual(['Cà phê nhân', 'Hồ tiêu', 'Sầu riêng']);
  });

  it('ignores dealers without crop tags', () => {
    expect(mergeCropTags([], [{} as DealerCard])).toEqual([]);
  });
});
