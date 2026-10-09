import { RuleIntentParser } from './rule-intent-parser';

const crops = [
  ['ca-phe-nhan', 'Cà phê nhân', 'ca phe nhan'],
  ['ca-phe-nhan', 'Cà phê nhân', 'ca phe'],
  ['ca-phe-tuoi', 'Cà phê tươi', 'cf tuoi'],
  ['ho-tieu', 'Hồ tiêu', 'tieu'],
  ['sau-rieng', 'Sầu riêng', 'sau rieng'],
  ['sau-rieng', 'Sầu riêng', 'ri6'],
  ['dieu', 'Điều', 'hat dieu'],
  ['lua', 'Lúa', 'lua'],
  ['lua', 'Lúa', 'lua ir50404'],
  ['bo', 'Bơ', 'bo 034'],
  ['xoai', 'Xoài', 'xoai'],
  ['thanh-long', 'Thanh long', 'thanh long'],
].map(([id, name, alias_norm]) => ({ id, name, alias_norm }));
const places = [
  ['cu mgar', 'dak-lak'],
  ['dak nong', 'lam-dong'],
  ['bao loc', 'lam-dong'],
  ['sai gon', 'ho-chi-minh'],
].map(([alias_norm, province_code]) => ({
  alias_norm,
  province_code,
  commune_code: null,
}));
const db = {
  query: jest.fn(async (sql: string) =>
    sql.includes('agri_crop_aliases') ? crops : places,
  ),
};
const now = new Date('2026-09-28T03:00:00.000Z');
let parser: RuleIntentParser;
beforeAll(async () => {
  parser = new RuleIntentParser(db as any);
  await parser.refreshAliases();
});
const parse = (text: string) =>
  parser.parse(text, { now, defaultProvinceCode: 'dak-lak' });

describe('golden intent parser table', () => {
  const table: [
    string,
    string,
    string | null,
    number | null,
    string | null,
    string?,
    string?,
    (number | null)?,
    string?,
  ][] = [
    [
      "Tôi có 5 tấn cà phê nhân ở Cư M'gar cần bán trong tuần này",
      'sell',
      'ca-phe-nhan',
      5000,
      'dak-lak',
      '2026-09-28',
      '2026-10-04',
      null,
    ],
    [
      'bán 3 tạ tiêu giá 145k',
      'sell',
      'ho-tieu',
      300,
      'dak-lak',
      undefined,
      undefined,
      145000,
    ],
    [
      'cần bán 2 tấn rưỡi cf tươi, mai có hàng, đến lấy giùm',
      'sell',
      'ca-phe-tuoi',
      2500,
      'dak-lak',
      '2026-09-29',
      '2026-09-29',
      null,
      'pickup',
    ],
    [
      'Nhà em có khoảng 800 ký sầu riêng ri6 ở Đắk Nông',
      'sell',
      'sau-rieng',
      800,
      'lam-dong',
      undefined,
      undefined,
      null,
    ],
    [
      'bán 1.200kg hạt điều, tự chở ra đại lý',
      'sell',
      'dieu',
      1200,
      'dak-lak',
      undefined,
      undefined,
      null,
      'dropoff',
    ],
    [
      'cần mua 10 bao phân NPK 16-16-8 giao tận nhà',
      'buy',
      null,
      null,
      'dak-lak',
      undefined,
      undefined,
      null,
      'dropoff',
    ],
    [
      'tìm mua thuốc trừ sâu cho sầu riêng ở Bảo Lộc',
      'buy',
      null,
      null,
      'lam-dong',
    ],
    [
      'có 3-4 tấn lúa IR50404 cuối tuần này bán',
      'sell',
      'lua',
      4000,
      'dak-lak',
      '2026-10-03',
      '2026-10-04',
      null,
    ],
    ['bán cà phê', 'sell', null, null, 'dak-lak'],
    [
      '5 tấn thanh long',
      'sell',
      'thanh-long',
      5000,
      'dak-lak',
      undefined,
      undefined,
      null,
    ],
    ['tôi muốn bán', 'sell', null, null, 'dak-lak'],
    [
      'bán 2 tấn bơ 034 ngày 15/10 giá 30 nghìn',
      'sell',
      'bo',
      2000,
      'dak-lak',
      '2026-10-15',
      '2026-10-15',
      30000,
    ],
    [
      'Sài Gòn cần bán nửa tấn xoài',
      'sell',
      'xoai',
      500,
      'ho-chi-minh',
      undefined,
      undefined,
      null,
    ],
    ['bán ít tiêu', 'sell', 'ho-tieu', null, 'dak-lak'],
    ['mua', 'buy', null, null, 'dak-lak'],
  ];
  it.each(table.map((row) => [row]))(
    '%s',
    async ([input, side, crop, kg, province, start, end, price, pref]) => {
      const r = await parse(input);
      expect(r.side).toBe(side);
      expect(r.cropId).toBe(crop);
      expect(r.quantityKg).toBe(kg);
      expect(r.provinceCode).toBe(province);
      if (start) expect(r.windowStart).toBe(start);
      if (end) expect(r.windowEnd).toBe(end);
      if (price !== undefined) expect(r.expectedPricePerKg).toBe(price);
      if (pref) expect(r.fulfillmentPref).toBe(pref);
    },
  );
  it('retains product and unit text', async () => {
    const a = await parse('cần mua 10 bao phân NPK 16-16-8 giao tận nhà');
    expect(a.productQuery).toContain('npk 16-16-8');
    expect(a.quantityText).toBe('10 bao');
    expect(a.missing).toEqual([]);
    const b = await parse('tìm mua thuốc trừ sâu cho sầu riêng ở Bảo Lộc');
    expect(b.productQuery).toContain('thuoc tru sau');
  });
  it('asks for missing sell fields', async () => {
    expect((await parse('bán cà phê')).followUp).toBe(
      'Ý bạn là: Cà phê tươi hay Cà phê nhân?',
    );
    expect((await parse('bán ít tiêu')).followUp).toBe(
      'Khoảng bao nhiêu kg (hoặc tấn)?',
    );
    expect((await parse('tôi muốn bán')).followUp).toBe(
      'Bạn muốn bán loại nông sản nào?',
    );
    expect((await parse('mua')).followUp).toBe('Bạn cần mua vật tư gì?');
  });
  it.each([
    ['mười yến tiêu', 100],
    ['một tạ tiêu', 100],
    ['hai ký rưỡi tiêu', 2.5],
    ['5,5 tấn tiêu', 5500],
  ])('parses unit %s', async (input, kg) => {
    expect((await parse(input)).quantityKg).toBe(kg);
  });
  it('requires price markers and handles bare giá', async () => {
    expect((await parse('bán 2 tấn tiêu giá 22')).expectedPricePerKg).toBe(
      22000,
    );
    expect((await parse('bán 2 tấn tiêu 22')).expectedPricePerKg).toBeNull();
    expect(
      (await parse('bán 2 tấn tiêu giá khoảng 22')).expectedPricePerKg,
    ).toBe(22000);
    expect(
      (await parse('bán 2 tấn tiêu khoảng 22')).expectedPricePerKg,
    ).toBeNull();
    expect(
      (await parse('bán 5 tấn tiêu giá 800 ký')).expectedPricePerKg,
    ).toBeNull();
  });
  it('does not reuse a quantity number as a price', async () => {
    const r = await parse('Nhà em có khoảng 800 ký sầu riêng ri6 ở Đắk Nông');
    expect(r.quantityKg).toBe(800);
    expect(r.expectedPricePerKg).toBeNull();
  });
  it('reads a marked per-kg price after a quantity', async () => {
    const r = await parse('bán 5 tấn tiêu khoảng 145 nghìn một ký');
    expect(r.quantityKg).toBe(5000);
    expect(r.expectedPricePerKg).toBe(145000);
  });
  it('asks which crop generic coffee means', async () => {
    const r = await parse('bán cà phê');
    expect(r.cropId).toBeNull();
    expect(r.cropCandidates.map((c) => c.name).sort()).toEqual(
      ['Cà phê tươi', 'Cà phê nhân'].sort(),
    );
    expect(r.missing).toContain('crop');
    expect(r.followUp).toBe('Ý bạn là: Cà phê tươi hay Cà phê nhân?');
  });
  it.each([
    ['ngày mai', '2026-09-29', '2026-09-29'],
    ['tuần sau', '2026-10-05', '2026-10-11'],
    ['tháng này', '2026-09-28', '2026-09-30'],
    ['trong 3 ngày', '2026-09-28', '2026-10-01'],
  ])('parses time %s', async (phrase, start, end) => {
    const r = await parse(`bán 2 tấn tiêu ${phrase}`);
    expect([r.windowStart, r.windowEnd]).toEqual([start, end]);
  });
  it('returns tied aliases as candidates', async () => {
    const p = new RuleIntentParser({
      query: async (sql: string) =>
        sql.includes('agri_crop_aliases')
          ? [
              { id: 'a', name: 'A', alias_norm: 'tieu' },
              { id: 'b', name: 'B', alias_norm: 'dieu' },
            ]
          : [],
    } as any);
    await p.refreshAliases();
    const r = await p.parse('bán 2 tấn tiêu điều', {
      now,
      defaultProvinceCode: 'dak-lak',
    });
    expect(r.cropId).toBeNull();
    expect(r.cropCandidates).toHaveLength(2);
    expect(r.followUp).toContain('hay');
  });
});
