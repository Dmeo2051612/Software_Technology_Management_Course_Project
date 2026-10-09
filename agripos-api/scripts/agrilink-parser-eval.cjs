/**
 * Chấm bộ phân tích câu nhu cầu Bán/Mua đang chạy (bộ luật, DeepSeek hoặc Gemini) trên các câu mẫu có đáp án.
 * Gọi API local thật bằng tài khoản nông dân demo; mỗi câu chấm 6 trường.
 *
 *   npm run agrilink:parser-eval
 *
 * Đổi AGRILINK_AI_PROVIDER trong .env, khởi động lại API rồi chạy lại để so hai bộ.
 * Gói miễn phí của Gemini chỉ cho vài lượt mỗi phút: đặt EVAL_DELAY_MS=13000 để giãn cách các câu.
 */
require('dotenv').config({ quiet: true });

const base =
  process.env.SMOKE_BASE_URL ||
  `http://127.0.0.1:${process.env.APP_PORT || 3000}/api/v1`;
const email = process.env.EVAL_EMAIL || 'farmer-demo@agrilink.vn';
const password = process.env.SEED_PASSWORD || process.env.SEED_FARMER_PASSWORD;
if (!password) throw new Error('Đặt SEED_FARMER_PASSWORD (mật khẩu tài khoản demo) trong .env.');

// [câu, bên, nông sản, kg, giá đ/kg, cách giao, tỉnh]. Nhu cầu mua: ô nông sản là true = phải có tên vật tư.
// Tài khoản demo không có tỉnh trong hồ sơ, nên câu không nêu địa danh thì tỉnh phải là null.
const CASES = [
  // Câu viết gọn, bộ luật đã xử lý được
  ['Bán 5 tạ tiêu ở Đắk Lắk, giá khoảng 150 nghìn, cần đại lý tới lấy', 'sell', 'Hồ tiêu', 500, 150000, 'pickup', 'dak-lak'],
  ['Cần mua 10 bao phân NPK 16-16-8 giao tận nhà ở Đắk Lắk', 'buy', true, null, null, 'dropoff', 'dak-lak'],
  ['Hồ Chí Minh cần bán nửa tấn xoài', 'sell', 'Xoài', 500, null, 'any', 'ho-chi-minh'],
  ['Thanh lý 4 tạ hạt điều ở Đắk Lắk', 'sell', 'Điều', 400, null, 'any', 'dak-lak'],
  ['bán 3 tạ hồ tiêu', 'sell', 'Hồ tiêu', 300, null, 'any', null],
  ['mình có 2 tấn sắn lát khô ở Gia Lai, tự chở ra đại lý', 'sell', 'Sắn lát khô', 2000, null, 'dropoff', 'gia-lai'],
  // Câu nói tự nhiên, viết tắt, từ địa phương
  ['nhà còn chừng năm trăm ký tiu đen ở Đắk Lắk, thứ bảy ghé vườn cân giùm, giá trăm rưỡi', 'sell', 'Hồ tiêu', 500, 150000, 'pickup', 'dak-lak'],
  ['Gia Lai, cần bán 2 tấn rưỡi cà phê nhân xô, ai mua lên rẫy chở giùm', 'sell', 'Cà phê nhân', 2500, null, 'pickup', 'gia-lai'],
  ['có 1 tấn 2 cf nhân ở Lâm Đồng muốn đẩy đi, giá 118 ngàn', 'sell', 'Cà phê nhân', 1200, 118000, 'any', 'lam-dong'],
  ['kiếm mấy bao urê với kali cho vườn cà ở Buôn Ma Thuột, chở tới giùm', 'buy', true, null, null, 'dropoff', 'dak-lak'],
  ['tìm thuốc trị rệp sáp cho cà phê ở Gia Lai, em tự ra lấy', 'buy', true, null, null, 'pickup', 'gia-lai'],
  ['Sầu riêng Ri6 tầm 3 tấn, vườn ở Lâm Đồng, thương lái nào tới cắt', 'sell', 'Sầu riêng', 3000, null, 'pickup', 'lam-dong'],
  ['bơ 034 khoảng 7 tạ ở Lâm Đồng, 32 nghìn một ký', 'sell', 'Bơ', 700, 32000, 'any', 'lam-dong'],
  ['ai thu mua chanh dây không, nhà có 600kg ở Gia Lai', 'sell', 'Chanh dây', 600, null, 'any', 'gia-lai'],
  ['mua giống sầu riêng Musang King ở Đắk Lắk', 'buy', true, null, null, 'any', 'dak-lak'],
  ['1 tấn 5 ngô hạt khô, Đắk Lắk, đại lý xuống tận nhà lấy được không', 'sell', 'Ngô', 1500, null, 'pickup', 'dak-lak'],
];
const FIELDS = ['bên', 'nông sản', 'kg', 'giá', 'cách giao', 'tỉnh'];

async function login() {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (r.ok) return j.data.accessToken;
    if (r.status !== 429) throw new Error(`Đăng nhập ${email}: ${j.message}`);
    await new Promise((ok) => setTimeout(ok, 15000));
  }
  throw new Error('Đăng nhập bị giới hạn tần suất');
}

(async () => {
  const token = await login();
  const score = FIELDS.map(() => 0);
  const parsers = {};
  let perfect = 0;
  const delay = Number(process.env.EVAL_DELAY_MS) || 0;
  for (const [i, [text, side, crop, kg, price, fulfillment, province]] of CASES.entries()) {
    if (delay && i) await new Promise((ok) => setTimeout(ok, delay));
    const r = await fetch(`${base}/marketplace/intents/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j)}`);
    const p = j.data;
    parsers[p.parser] = (parsers[p.parser] || 0) + 1;
    const ok = [
      p.side === side,
      crop === true ? !!p.productQuery : p.cropName === crop,
      side === 'buy' || p.quantityKg === kg,
      p.expectedPricePerKg === price,
      p.fulfillmentPref === fulfillment,
      p.provinceCode === province,
    ];
    ok.forEach((v, i) => (score[i] += v ? 1 : 0));
    if (ok.every(Boolean)) perfect++;
    const wrong = FIELDS.filter((_, i) => !ok[i]);
    console.log(`${wrong.length ? '✗' : '✓'} [${p.parser}] ${text}`);
    if (wrong.length)
      console.log(
        `    sai: ${wrong.join(', ')} → bên=${p.side} nông sản=${p.cropName ?? p.productQuery} kg=${p.quantityKg} giá=${p.expectedPricePerKg} giao=${p.fulfillmentPref} tỉnh=${p.provinceCode}`,
      );
  }
  const n = CASES.length;
  console.log(`\nBộ phân tích: ${Object.entries(parsers).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(FIELDS.map((f, i) => `${f} ${score[i]}/${n}`).join(' · '));
  console.log(`Đúng hết 6 trường: ${perfect}/${n} câu`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
