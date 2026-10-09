import type { DealerCard, DealerCropTag } from '../../../services/agrilink.types';

/** Gộp nhãn nông sản của nhiều đại lý, không trùng, sắp theo tên. */
export function mergeCropTags(current: DealerCropTag[], dealers: DealerCard[]): DealerCropTag[] {
  const byCode = new Map(current.map((tag) => [tag.code, tag]));
  dealers.forEach((dealer) => dealer.crops?.forEach((tag) => byCode.set(tag.code, tag)));
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
