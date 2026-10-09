import { ParsedIntent } from './intent-parser';

export type IntentDraft = Omit<
  ParsedIntent,
  'missing' | 'followUp' | 'confidence'
>;

/** Trường còn thiếu, câu hỏi lại và độ tin cậy — mọi bộ phân tích tính giống nhau. */
export function completeIntent(d: IntentDraft): ParsedIntent {
  const missing: ParsedIntent['missing'] = [];
  if (!d.side) missing.push('side');
  if (d.side === 'sell' && !d.cropId) missing.push('crop');
  if (d.side === 'buy' && !d.productQuery) missing.push('product');
  if (d.side === 'sell' && d.quantityKg === null) missing.push('quantity');
  if (!d.provinceCode) missing.push('place');
  const followUp =
    missing[0] === 'side'
      ? 'Bạn muốn bán hay mua?'
      : missing[0] === 'crop'
        ? d.cropCandidates.length > 1
          ? `Ý bạn là: ${d.cropCandidates.map((c) => c.name).join(' hay ')}?`
          : 'Bạn muốn bán loại nông sản nào?'
        : missing[0] === 'product'
          ? 'Bạn cần mua vật tư gì?'
          : missing[0] === 'quantity'
            ? 'Khoảng bao nhiêu kg (hoặc tấn)?'
            : missing[0] === 'place'
              ? 'Hàng ở xã/tỉnh nào?'
              : null;
  const required =
    d.side === 'buy'
      ? ['side', 'product', 'place']
      : ['side', 'crop', 'quantity', 'place'];
  return {
    ...d,
    missing,
    followUp,
    confidence:
      (required.length - missing.filter((m) => required.includes(m)).length) /
      required.length,
  };
}
