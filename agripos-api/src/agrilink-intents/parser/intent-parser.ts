export type IntentSide = 'sell' | 'buy';
export interface ParseContext {
  now: Date;
  defaultProvinceCode?: string;
  defaultCommuneCode?: string;
}
/** Mô hình ngôn ngữ có thể dùng để phân tích câu (AGRILINK_AI_PROVIDER). */
export type AiParser = 'gemini' | 'deepseek';
export interface ParsedIntent {
  /** Bộ đã phân tích câu: luật, hay một mô hình ngôn ngữ. */
  parser: 'rules' | AiParser;
  side: IntentSide | null;
  cropId: string | null;
  cropName: string | null;
  cropCandidates: { id: string; name: string }[];
  productQuery: string | null;
  quantityKg: number | null;
  quantityText: string;
  provinceCode: string | null;
  communeCode: string | null;
  placeSource: 'text' | 'profile' | null;
  windowStart: string;
  windowEnd: string;
  expectedPricePerKg: number | null;
  fulfillmentPref: 'pickup' | 'dropoff' | 'any';
  missing: ('side' | 'crop' | 'product' | 'quantity' | 'place')[];
  followUp: string | null;
  confidence: number;
}
export interface IntentParser {
  parse(text: string, ctx: ParseContext): Promise<ParsedIntent>;
}
export const INTENT_PARSER = 'INTENT_PARSER';
