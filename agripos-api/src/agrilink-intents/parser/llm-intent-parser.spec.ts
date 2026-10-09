import {
  AI_INTENT_SCHEMA,
  LlmIntentParser,
  GenerateJson,
  systemPrompt,
} from './llm-intent-parser';
import { RuleIntentParser } from './rule-intent-parser';

const crops = [
  ['ca-phe-nhan', 'Cà phê nhân', 'ca phe nhan'],
  ['ca-phe-nhan', 'Cà phê nhân', 'ca phe'],
  ['ca-phe-tuoi', 'Cà phê tươi', 'cf tuoi'],
  ['ho-tieu', 'Hồ tiêu', 'tieu'],
  ['sau-rieng', 'Sầu riêng', 'sau rieng'],
].map(([id, name, alias_norm]) => ({ id, name, alias_norm }));
const places = [
  ['cu mgar', 'dak-lak', null],
  ['ea tul', 'dak-lak', 'ea-tul'],
  ['bao loc', 'lam-dong', null],
].map(([alias_norm, province_code, commune_code]) => ({
  alias_norm,
  province_code,
  commune_code,
}));
const db = {
  query: jest.fn(async (sql: string) =>
    sql.includes('agri_crop_aliases') ? crops : places,
  ),
};
const now = new Date('2026-09-28T03:00:00.000Z'); // Thứ Hai 28/09 giờ Việt Nam
const ctx = { now, defaultProvinceCode: 'dak-lak' };
let rules: RuleIntentParser;
beforeAll(async () => {
  rules = new RuleIntentParser(db as any);
  await rules.refreshAliases();
});

const reply = (over: Record<string, unknown>) =>
  JSON.stringify({
    side: 'unknown',
    crop: null,
    cropOptions: [],
    product: null,
    quantityKg: null,
    quantityText: null,
    place: null,
    windowStart: null,
    windowEnd: null,
    pricePerKg: null,
    fulfillment: 'any',
    ...over,
  });
const make = (generate: GenerateJson, dailyLimit = 100) =>
  new LlmIntentParser(rules, generate, { name: 'deepseek', dailyLimit });

describe('LlmIntentParser', () => {
  it('lấy các trường mô hình hiểu được mà bộ luật bỏ sót', async () => {
    const text =
      'nhà còn chừng năm trăm ký tiu đen, thứ bảy này ghé vườn ở Ea Tul cân giùm, giá trăm rưỡi';
    const generate = jest.fn<Promise<string>, Parameters<GenerateJson>>(
      async () =>
        reply({
          side: 'sell',
          crop: 'Hồ tiêu',
          quantityKg: 500,
          quantityText: 'năm trăm ký',
          place: 'Ea Tul',
          windowStart: '2026-10-03',
          windowEnd: '2026-10-03',
          pricePerKg: 150000,
          fulfillment: 'pickup',
        }),
    );
    const r = await make(generate).parse(text, ctx);
    expect(r).toMatchObject({
      parser: 'deepseek',
      side: 'sell',
      cropId: 'ho-tieu',
      cropName: 'Hồ tiêu',
      quantityKg: 500,
      provinceCode: 'dak-lak',
      communeCode: 'ea-tul',
      placeSource: 'text',
      windowStart: '2026-10-03',
      windowEnd: '2026-10-03',
      expectedPricePerKg: 150000,
      fulfillmentPref: 'pickup',
      missing: [],
      followUp: null,
      confidence: 1,
    });
    const [system, sent, schema] = generate.mock.calls[0];
    expect(sent).toBe(text);
    expect(schema).toBe(AI_INTENT_SCHEMA);
    expect(system).toContain('Hồ tiêu');
  });

  it('bỏ giá trị không hợp lệ, giữ kết quả bộ luật cho trường đó', async () => {
    const r = await make(async () =>
      reply({
        side: 'sell',
        crop: 'Cao su', // không có trong danh mục
        quantityKg: -3,
        windowStart: '2026-09-01', // đã qua
        windowEnd: '2026-09-02',
        pricePerKg: 5,
        fulfillment: 'bay',
      }),
    ).parse('bán 3 tạ tiêu giá 145k', ctx);
    expect(r).toMatchObject({
      parser: 'deepseek',
      cropId: 'ho-tieu',
      quantityKg: 300,
      expectedPricePerKg: 145000,
      windowStart: '2026-09-28',
      windowEnd: '2026-10-05',
      fulfillmentPref: 'any',
    });
  });

  it('nói chung chung thì đưa các lựa chọn và hỏi lại', async () => {
    const r = await make(async () =>
      reply({
        side: 'sell',
        cropOptions: ['Cà phê tươi', 'Cà phê nhân'],
        quantityKg: 2000,
      }),
    ).parse('bán 2 tấn cà phê', ctx);
    expect(r.cropId).toBeNull();
    expect(r.cropCandidates.map((c) => c.id)).toEqual([
      'ca-phe-tuoi',
      'ca-phe-nhan',
    ]);
    expect(r.followUp).toBe('Ý bạn là: Cà phê tươi hay Cà phê nhân?');
  });

  it('nhu cầu mua lấy tên vật tư từ mô hình', async () => {
    const r = await make(async () =>
      reply({
        side: 'buy',
        product: 'phân NPK 16-16-8',
        fulfillment: 'dropoff',
      }),
    ).parse('kiếm vài bao npk 16 16 8 chở tới nhà giùm', ctx);
    expect(r).toMatchObject({
      parser: 'deepseek',
      side: 'buy',
      productQuery: 'phân NPK 16-16-8',
      cropId: null,
      fulfillmentPref: 'dropoff',
      missing: [],
    });
  });

  it('mô hình lỗi hoặc trả JSON hỏng thì dùng nguyên kết quả bộ luật', async () => {
    const base = await rules.parse('bán 3 tạ tiêu giá 145k', ctx);
    for (const generate of [
      async () => Promise.reject(new Error('timeout')),
      async () => 'không phải json',
    ])
      expect(await make(generate).parse('bán 3 tạ tiêu giá 145k', ctx)).toEqual(
        base,
      );
    expect(base.parser).toBe('rules');
  });

  it('cùng câu trong 10 phút chỉ gọi mô hình một lần', async () => {
    const generate = jest.fn(async () =>
      reply({ side: 'sell', crop: 'Hồ tiêu', quantityKg: 300 }),
    );
    const p = make(generate);
    await p.parse('bán 3 tạ tiêu', ctx);
    await p.parse('bán 3 tạ tiêu ', ctx);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('hết hạn mức trong ngày thì dùng bộ luật', async () => {
    const generate = jest.fn(async () =>
      reply({ side: 'sell', crop: 'Hồ tiêu', quantityKg: 300 }),
    );
    const p = make(generate, 1);
    expect((await p.parse('bán 3 tạ tiêu', ctx)).parser).toBe('deepseek');
    expect((await p.parse('bán 5 tạ tiêu', ctx)).parser).toBe('rules');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('vượt hạn mức theo phút thì nghỉ gọi mô hình một phút', async () => {
    const generate = jest.fn(async () =>
      Promise.reject(Object.assign(new Error('quota'), { status: 429 })),
    );
    const p = make(generate);
    await p.parse('bán 3 tạ tiêu', ctx);
    await p.parse('bán 4 tạ tiêu', {
      ...ctx,
      now: new Date(now.getTime() + 30000),
    });
    expect(generate).toHaveBeenCalledTimes(1);
    await p.parse('bán 5 tạ tiêu', {
      ...ctx,
      now: new Date(now.getTime() + 61000),
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('hướng dẫn có ngày hôm nay, thứ và danh mục nông sản', () => {
    const s = systemPrompt('2026-09-28', ['Hồ tiêu', 'Cà phê nhân']);
    expect(s).toContain('Thứ Hai, ngày 2026-09-28');
    expect(s).toContain('Danh sách nông sản: Hồ tiêu; Cà phê nhân.');
  });
});
