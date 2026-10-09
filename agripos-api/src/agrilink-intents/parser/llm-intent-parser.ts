import { Logger } from '@nestjs/common';
import { completeIntent } from './complete-intent';
import {
  AiParser,
  IntentParser,
  ParseContext,
  ParsedIntent,
} from './intent-parser';
import { RuleIntentParser } from './rule-intent-parser';

/** Gửi hướng dẫn + câu của người dùng, nhận về chuỗi JSON theo schema. */
export type GenerateJson = (
  system: string,
  text: string,
  schema: object,
) => Promise<string>;

export interface LlmParserOptions {
  /** Hãng đang dùng, ghi vào kết quả và cột agrilink_intents.parser. */
  name: AiParser;
  /** Số lần gọi tối đa mỗi ngày (theo giờ Việt Nam); vượt thì dùng bộ luật. */
  dailyLimit: number;
}

type AiIntent = {
  side: 'sell' | 'buy' | 'unknown';
  crop: string | null;
  cropOptions: string[];
  product: string | null;
  quantityKg: number | null;
  quantityText: string | null;
  place: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  pricePerKg: number | null;
  fulfillment: 'pickup' | 'dropoff' | 'any';
};

const nullable = (type: string, description: string) => ({
  type: [type, 'null'],
  description,
});
export const AI_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    side: { type: 'string', enum: ['sell', 'buy', 'unknown'] },
    crop: nullable(
      'string',
      'Khi bán: tên nông sản, chép đúng một tên trong danh sách nông sản. Không chắc thì null.',
    ),
    cropOptions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Khi người dùng nói chung chung (vd "cà phê"), các tên trong danh sách có thể đúng.',
    },
    product: nullable(
      'string',
      'Khi mua: vật tư cần mua, ngắn gọn như người dùng viết (vd "phân NPK 16-16-8").',
    ),
    quantityKg: nullable('number', 'Khối lượng quy ra kg.'),
    quantityText: nullable(
      'string',
      'Cụm khối lượng đúng như người dùng viết.',
    ),
    place: nullable(
      'string',
      'Địa danh (xã, huyện, tỉnh) đúng như người dùng viết. Không nhắc thì null.',
    ),
    windowStart: nullable('string', 'Ngày bắt đầu, dạng YYYY-MM-DD.'),
    windowEnd: nullable('string', 'Ngày kết thúc, dạng YYYY-MM-DD.'),
    pricePerKg: nullable('number', 'Giá mong muốn, đồng/kg.'),
    fulfillment: { type: 'string', enum: ['pickup', 'dropoff', 'any'] },
  },
  required: [
    'side',
    'crop',
    'cropOptions',
    'product',
    'quantityKg',
    'quantityText',
    'place',
    'windowStart',
    'windowEnd',
    'pricePerKg',
    'fulfillment',
  ],
  additionalProperties: false,
};

const WEEKDAYS = [
  'Chủ nhật',
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const vnDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);

export function systemPrompt(today: string, crops: string[]): string {
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  return [
    'Bạn đọc một câu nông dân Việt Nam viết để đăng nhu cầu bán nông sản hoặc mua vật tư nông nghiệp, rồi trả về một đối tượng JSON có đúng các khoá như ví dụ cuối.',
    `Hôm nay là ${weekday}, ngày ${today} (giờ Việt Nam).`,
    '',
    'Quy ước:',
    '- side: "sell" khi muốn bán nông sản; "buy" khi muốn mua vật tư (phân, thuốc, giống...); "unknown" khi không rõ.',
    '- Khối lượng: 1 tạ = 100 kg, 1 yến = 10 kg, 1 tấn = 1000 kg, "rưỡi" là thêm một nửa đơn vị (2 tấn rưỡi = 2500 kg). Đơn vị bao, bịch không quy ra kg được thì quantityKg = null.',
    '- Giá: "145k", "145 nghìn", "145 ngàn" là 145000 đồng/kg. Chỉ điền khi người dùng nói giá.',
    '- fulfillment khi bán: "pickup" nếu muốn đại lý đến lấy/thu mua tận vườn; "dropoff" nếu tự chở ra đại lý. Khi mua: "dropoff" nếu muốn giao tận nơi; "pickup" nếu tự ra lấy. Không nói thì "any".',
    '- Thời gian: "hôm nay", "mai", "tuần này", "tuần sau", "cuối tuần", "dd/mm"... đổi ra windowStart và windowEnd. Không nói thời gian thì windowStart = hôm nay, windowEnd = hôm nay + 7 ngày.',
    '- crop chỉ được chọn trong danh sách dưới đây (chép đúng chính tả). Từ địa phương, viết tắt, không dấu vẫn quy về đúng tên (vd "tiêu", "tiu" là Hồ tiêu; "cf" là cà phê).',
    '- Không đoán. Thông tin người dùng không nói thì để null.',
    '',
    `Danh sách nông sản: ${crops.join('; ')}.`,
    '',
    'Ví dụ: "bán 5 tạ tiêu ở Đắk Lắk giá 150k, đại lý tới lấy" →',
    JSON.stringify({
      side: 'sell',
      crop: 'Hồ tiêu',
      cropOptions: [],
      product: null,
      quantityKg: 500,
      quantityText: '5 tạ',
      place: 'Đắk Lắk',
      windowStart: today,
      windowEnd: addDays(today, 7),
      pricePerKg: 150000,
      fulfillment: 'pickup',
    }),
  ].join('\n');
}

/**
 * Phân tích câu nhu cầu bằng mô hình ngôn ngữ (Gemini, DeepSeek). Luôn chạy bộ luật trước: mô hình lỗi, quá giờ,
 * hết hạn mức hay trả giá trị không hợp lệ thì giữ kết quả của bộ luật cho trường đó.
 * Chấm điểm và xếp hạng đại lý không dùng AI.
 */
export class LlmIntentParser implements IntentParser {
  private readonly log = new Logger(LlmIntentParser.name);
  private readonly cache = new Map<
    string,
    { at: number; value: ParsedIntent }
  >();
  private usage = { day: '', calls: 0 };
  private pausedUntil = 0;

  constructor(
    private readonly rules: RuleIntentParser,
    private readonly generate: GenerateJson,
    private readonly options: LlmParserOptions,
  ) {}

  async parse(text: string, ctx: ParseContext): Promise<ParsedIntent> {
    const base = await this.rules.parse(text, ctx);
    const today = vnDate(ctx.now);
    // Bấm "Phân tích" rồi "Tìm đại lý" phân tích cùng một câu hai lần: dùng lại kết quả 10 phút.
    const key = [
      text.trim(),
      today,
      ctx.defaultProvinceCode,
      ctx.defaultCommuneCode,
    ].join('|');
    const cached = this.cache.get(key);
    if (cached && ctx.now.getTime() - cached.at < 600000) return cached.value;

    if (ctx.now.getTime() < this.pausedUntil) return base;
    if (this.usage.day !== today) this.usage = { day: today, calls: 0 };
    if (this.usage.calls >= this.options.dailyLimit) return base;
    this.usage.calls++;

    let ai: AiIntent;
    try {
      ai = JSON.parse(
        await this.generate(
          systemPrompt(today, this.rules.cropNames()),
          text,
          AI_INTENT_SCHEMA,
        ),
      ) as AiIntent;
    } catch (e) {
      // Vượt hạn mức theo phút (gói miễn phí: vài lượt/phút): nghỉ một phút thay vì gọi rồi bị từ chối liên tục.
      if ((e as { status?: number }).status === 429)
        this.pausedUntil = ctx.now.getTime() + 60000;
      this.log.warn(
        `${this.options.name} lỗi, dùng bộ luật: ${(e as Error).message}`,
      );
      return base;
    }
    const value = this.merge(base, ai, today);
    this.cache.set(key, { at: ctx.now.getTime(), value });
    if (this.cache.size > 500)
      this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  private merge(base: ParsedIntent, ai: AiIntent, today: string): ParsedIntent {
    const num = (v: unknown, min: number, max: number) =>
      typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
        ? v
        : null;
    const str = (v: unknown, max = 200) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

    const side = ai.side === 'sell' || ai.side === 'buy' ? ai.side : base.side;

    const crop = str(ai.crop) ? this.rules.resolveCrop(ai.crop!) : null;
    const options = (Array.isArray(ai.cropOptions) ? ai.cropOptions : [])
      .map((n) => (str(n) ? this.rules.resolveCrop(n) : null))
      .filter((c): c is { id: string; name: string } => !!c);
    const candidates = crop
      ? [crop]
      : options.length
        ? [...new Map(options.map((c) => [c.id, c])).values()]
        : base.cropCandidates;
    const chosen = crop ?? (candidates.length === 1 ? candidates[0] : null);

    const placeText = str(ai.place);
    const place = placeText ? this.rules.matchPlaces(placeText)[0] : undefined;

    const start = str(ai.windowStart);
    const end = str(ai.windowEnd);
    const windowOk =
      !!start &&
      !!end &&
      ISO_DATE.test(start) &&
      ISO_DATE.test(end) &&
      start >= today &&
      end >= start &&
      end <= addDays(today, 366);

    const fulfillment = ['pickup', 'dropoff', 'any'].includes(ai.fulfillment)
      ? ai.fulfillment
      : base.fulfillmentPref;

    return completeIntent({
      parser: this.options.name,
      side,
      cropId: side === 'sell' ? (chosen?.id ?? null) : null,
      cropName: side === 'sell' ? (chosen?.name ?? null) : null,
      cropCandidates: side === 'sell' ? candidates : [],
      productQuery:
        side === 'buy' ? (str(ai.product) ?? base.productQuery) : null,
      quantityKg: num(ai.quantityKg, 0.1, 10_000_000) ?? base.quantityKg,
      quantityText: str(ai.quantityText, 60) ?? base.quantityText,
      provinceCode: place?.province_code ?? base.provinceCode,
      communeCode: place ? place.commune_code : base.communeCode,
      placeSource: place ? 'text' : base.placeSource,
      windowStart: windowOk ? start : base.windowStart,
      windowEnd: windowOk ? end : base.windowEnd,
      expectedPricePerKg:
        num(ai.pricePerKg, 1000, 2_000_000) ?? base.expectedPricePerKg,
      fulfillmentPref: fulfillment,
    });
  }
}
