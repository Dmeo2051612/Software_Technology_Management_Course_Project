// Development-only: seed 8 demo dealers for AgriLink with fertilizer listings, images,
// verifications and ratings. Deterministic ids → safe to rerun (rows are upserted).
// Images come from scripts/demo-assets (credits in CREDITS.md) and are copied into uploads/.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { createHash } = require('node:crypto');
const { mkdirSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');
const bcrypt = require('bcrypt');
const sharp = require('sharp');

const config = {
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionTimeoutMillis: 5000,
};
if (
  process.env.NODE_ENV === 'production' ||
  !['127.0.0.1', 'localhost'].includes(config.host)
)
  throw new Error('This utility only operates on local development databases.');

const ASSETS = join(__dirname, 'demo-assets');
const UPLOADS = join(__dirname, '..', 'uploads');

/** UUID cố định theo tên (dạng v5) để chạy lại không sinh bản ghi mới. */
const uid = (name) => {
  const h = createHash('sha1').update('agrilink-demo:' + name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// Danh mục phân bón dùng chung; mỗi đại lý chọn một phần, giá lệch theo hệ số của đại lý.
const CATALOG = {
  npk16: { name: 'Phân NPK 16-16-8 (bao 50kg)', unit: 'bao', price: 920000, cost: 840000, images: ['npk-granules', 'bags-warehouse'],
    description: 'NPK 3 màu cân đối đạm – lân – kali, dùng bón thúc giai đoạn sinh trưởng cho lúa, rau màu và cây công nghiệp.' },
  npk20: { name: 'Phân NPK 20-20-15 (bao 50kg)', unit: 'bao', price: 1150000, cost: 1050000, images: ['bags-warehouse', 'npk-granules'],
    description: 'Hạt đều, tan chậm, hàm lượng dinh dưỡng cao. Phù hợp cà phê, hồ tiêu, sầu riêng giai đoạn nuôi trái.' },
  urea: { name: 'Phân Urê hạt trong 46%N (bao 50kg)', unit: 'bao', price: 780000, cost: 715000, images: ['urea-prills'],
    description: 'Đạm Urê 46%, hạt trong, ít bụi. Bón thúc đẻ nhánh cho lúa, thúc lá cho rau màu.' },
  dap: { name: 'Phân DAP 18-46 (bao 50kg)', unit: 'bao', price: 1050000, cost: 960000, images: ['dap-granules', 'dap-granules-2'],
    description: 'Lân và đạm dễ tiêu, kích thích ra rễ mạnh. Dùng bón lót hoặc bón giai đoạn cây con.' },
  kcl: { name: 'Phân Kali clorua 60% K2O (bao 50kg)', unit: 'bao', price: 690000, cost: 620000, images: ['kcl-granules'],
    description: 'Kali đỏ dạng mảnh, tăng độ chắc hạt, độ ngọt trái, giúp cây cứng cáp chống đổ ngã.' },
  lan: { name: 'Phân lân nung chảy (bao 50kg)', unit: 'bao', price: 280000, cost: 240000, images: ['lan-granules'],
    description: 'Lân chậm tan, có canxi – magie, cải tạo đất chua phèn. Bón lót đầu vụ.' },
  trungluong: { name: 'Phân trung lượng Ca-Mg-S (bao 25kg)', unit: 'bao', price: 360000, cost: 310000, images: ['sulfur-granules'],
    description: 'Bổ sung canxi, magie, lưu huỳnh – hạn chế nứt trái, vàng lá gân xanh.' },
  npkla: { name: 'Phân bón lá NPK 19-19-19 hòa tan (gói 1kg)', unit: 'gói', price: 85000, cost: 68000, images: ['npk-soluble', 'npk-soluble-2'],
    description: 'Hòa tan hoàn toàn, phun lá hoặc tưới gốc qua hệ thống nhỏ giọt. Pha 20–30g/bình 16 lít.' },
  bonlalong: { name: 'Phân bón lá dạng lỏng kích ra hoa (chai 500ml)', unit: 'chai', price: 65000, cost: 50000, images: ['liquid-bottle'],
    description: 'Dinh dưỡng vi lượng dạng lỏng, hỗ trợ phân hóa mầm hoa, đậu trái. Pha 15–20ml/bình 16 lít.' },
  visinh: { name: 'Phân hữu cơ vi sinh (bao 20kg)', unit: 'bao', price: 145000, cost: 115000, images: ['biofertilizer-bag', 'compost-bags'],
    description: 'Chứa vi sinh vật có ích giúp phân giải lân, cố định đạm, cải tạo đất bạc màu.' },
  uhoai: { name: 'Phân hữu cơ ủ hoai (bao 40kg)', unit: 'bao', price: 120000, cost: 90000, images: ['compost-pile', 'compost-bags'],
    description: 'Phân chuồng ủ hoai với chế phẩm Trichoderma, không mùi, sạch mầm bệnh.' },
  trunque: { name: 'Phân trùn quế nguyên chất (bao 20kg)', unit: 'bao', price: 95000, cost: 72000, images: ['vermicompost', 'earthworms'],
    description: 'Tơi xốp, giàu mùn và vi sinh, dùng cho rau sạch, hoa kiểng, ươm cây giống.' },
  luagiong: { name: 'Lúa giống OM18 cấp xác nhận (bao 40kg)', unit: 'bao', price: 720000, cost: 640000, images: ['seed-rice', 'paddy-ripe'],
    description: 'Giống lúa thơm ngắn ngày (95–100 ngày), chịu mặn khá, tỷ lệ nảy mầm trên 85%. Sạ 80–100 kg/ha.' },
  homsan: { name: 'Hom sắn giống KM94 (bó 100 hom)', unit: 'bó', price: 90000, cost: 65000, images: ['cassava-cuttings', 'cassava-cuttings-2'],
    description: 'Hom sắn bánh tẻ dài 18–20 cm, sạch bệnh khảm lá. Năng suất củ cao, hàm lượng tinh bột 27–29%.' },
  ngogiong: { name: 'Ngô giống lai đơn (bao 10kg)', unit: 'bao', price: 1150000, cost: 1020000, images: ['maize-kernels', 'maize-kernels-2'],
    description: 'Ngô lai năng suất cao, chịu hạn, cứng cây. Thích hợp vụ hè thu và thu đông vùng đồi.' },
  voi: { name: 'Vôi nông nghiệp CaCO3 (bao 50kg)', unit: 'bao', price: 85000, cost: 62000, images: ['lime-pile'],
    description: 'Nâng pH đất chua, khử phèn, bổ sung canxi. Rải trước khi làm đất 10–15 ngày.' },
};

const DEALERS = [
  { slug: 'phu-nong', name: 'Đại lý Vật tư Phú Nông', initials: 'PN', tone: '#2E7D32', province: 'dak-lak', region: 'Tây Nguyên',
    address: '128 Phan Bội Châu, P. Tân Lợi, Buôn Ma Thuột, Đắk Lắk', phone: '0262 3851 128', lat: 12.6801, lng: 108.0441,
    hours: '6:30 – 18:00, Thứ 2 – Chủ nhật', fulfillment: ['pickup', 'delivery', 'at_dealer'], cover: 'cover-pepper-road', priceFactor: 1.0,
    bio: 'Hơn 15 năm cung cấp phân bón cho vườn cà phê, hồ tiêu khu vực Buôn Ma Thuột. Tư vấn lịch bón theo từng giai đoạn cây.',
    products: ['npk16', 'npk20', 'urea', 'dap', 'kcl', 'trungluong', 'npkla', 'visinh', 'voi', 'bonlalong'], sale: ['npk20'], out: ['bonlalong'],
    buy: [['ca-phe-nhan', 'Thu mua cà phê nhân xô', 108000, 50000], ['ho-tieu', 'Thu mua hồ tiêu đen 500g/l', 142000, 20000]],
    verified: true, stars: [5, 5, 4, 5, 5], delivery: { radius: 30, fee: 'free' } },
  { slug: 'hai-lua', name: 'Cửa hàng Phân bón Hai Lúa', initials: 'HL', tone: '#E08A00', province: 'can-tho', region: 'Đồng bằng sông Cửu Long',
    address: '45 Quốc lộ 91, P. Thốt Nốt, Cần Thơ', phone: '0292 3612 045', lat: 10.2683, lng: 105.5352,
    hours: '6:00 – 19:00 hằng ngày', fulfillment: ['pickup', 'delivery'], cover: 'cover-rice-green', priceFactor: 0.97,
    bio: 'Chuyên phân bón cho lúa và rau màu miền Tây. Giao tận ruộng bằng ghe, xe ba gác trong bán kính 20 km.',
    products: ['urea', 'dap', 'npk16', 'kcl', 'lan', 'voi', 'npkla', 'uhoai', 'visinh'], sale: ['urea', 'dap'], out: [],
    buy: [['lua', 'Thu mua lúa Đài Thơm 8 tươi', 7600, 150000]],
    verified: true, stars: [5, 4, 5, 4, 4, 5], delivery: { radius: 20, fee: 'per_trip', amount: 30000 } },
  { slug: 'thanh-dat', name: 'Thành Đạt Agri', initials: 'TĐ', tone: '#7B4FD6', province: 'lam-dong', region: 'Tây Nguyên',
    address: '312 Trần Phú, P. B\'Lao, Bảo Lộc, Lâm Đồng', phone: '0263 3864 312', lat: 11.5479, lng: 107.8077,
    hours: '7:00 – 17:30, nghỉ chiều Chủ nhật', fulfillment: ['pickup', 'delivery', 'at_dealer'], cover: 'cover-coffee-dalat', priceFactor: 1.04,
    bio: 'Phân bón và dinh dưỡng chuyên dùng cho cà phê, chè, sầu riêng vùng cao nguyên Lâm Đồng.',
    products: ['npk20', 'npk16', 'kcl', 'trungluong', 'npkla', 'bonlalong', 'visinh', 'trunque', 'voi'], sale: ['bonlalong'], out: [],
    buy: [['ca-phe-tuoi', 'Thu mua cà phê tươi (quả chín ≥ 90%)', 24500, 80000]],
    verified: true, stars: [5, 5, 5, 4], delivery: { radius: 40, fee: 'per_trip', amount: 50000 } },
  { slug: 'ba-mien', name: 'Vật tư Nông nghiệp Ba Miền', initials: 'BM', tone: '#1877F2', province: 'dong-thap', region: 'Đồng bằng sông Cửu Long',
    address: '17 Lý Thường Kiệt, P. Cao Lãnh, Đồng Tháp', phone: '0277 3851 017', lat: 10.4601, lng: 105.6326,
    hours: '6:30 – 18:30 hằng ngày', fulfillment: ['pickup', 'at_dealer'], cover: 'cover-rice-path', priceFactor: 0.99,
    bio: 'Đại lý cấp 1 phân bón – vôi – hữu cơ cho lúa, xoài, sen Đồng Tháp. Nhận đặt trước theo vụ.',
    products: ['urea', 'dap', 'npk16', 'lan', 'kcl', 'voi', 'uhoai', 'trunque'], sale: ['lan'], out: ['trunque'],
    buy: [['lua', 'Thu mua lúa IR50404 tươi', 6900, 150000]],
    verified: true, stars: [4, 4, 5, 3, 4], delivery: null },
  { slug: 'tay-nguyen-xanh', name: 'Phân bón Tây Nguyên Xanh', initials: 'TN', tone: '#0F9D8A', province: 'gia-lai', region: 'Tây Nguyên',
    address: '89 Lê Duẩn, P. Pleiku, Gia Lai', phone: '0269 3825 089', lat: 13.9718, lng: 108.0151,
    hours: '7:00 – 18:00, Thứ 2 – Thứ 7', fulfillment: ['pickup', 'delivery'], cover: 'cover-pepper-hill', priceFactor: 1.02,
    bio: 'Giải pháp dinh dưỡng cho hồ tiêu, cà phê, mắc ca. Có kỹ sư nông nghiệp tư vấn tại vườn.',
    products: ['npk20', 'npk16', 'urea', 'kcl', 'trungluong', 'npkla', 'visinh', 'uhoai', 'voi', 'bonlalong', 'trunque'], sale: ['visinh', 'npkla'], out: [],
    buy: [['ho-tieu', 'Thu mua hồ tiêu đen', 140000, 30000], ['ca-phe-nhan', 'Thu mua cà phê nhân', 107000, 50000]],
    verified: true, stars: [5, 4, 5, 5, 4, 5], delivery: { radius: 50, fee: 'per_trip', amount: 60000 } },
  { slug: 'nong-phat', name: 'Đại lý Nông Phát', initials: 'NP', tone: '#D81B60', province: 'an-giang', region: 'Đồng bằng sông Cửu Long',
    address: '203 Trần Hưng Đạo, P. Long Xuyên, An Giang', phone: '0296 3841 203', lat: 10.3866, lng: 105.4352,
    hours: '6:00 – 18:00 hằng ngày', fulfillment: ['pickup', 'delivery', 'at_dealer'], cover: 'cover-rice-planting', priceFactor: 0.98,
    bio: 'Phân bón, vôi và chế phẩm hữu cơ cho lúa ba vụ. Giá sỉ cho tổ hợp tác và hộ canh tác lớn.',
    products: ['urea', 'dap', 'npk16', 'kcl', 'lan', 'voi', 'npkla', 'visinh'], sale: ['npk16'], out: [],
    buy: [['lua', 'Thu mua lúa OM5451 tươi', 7200, 200000], ['ngo', 'Thu mua ngô hạt', 6300, 50000]],
    verified: false, stars: [4, 5, 4], delivery: { radius: 25, fee: 'free' } },
  { slug: 'hoa-binh-phat', name: 'Kho Phân bón Hòa Bình Phát', initials: 'HB', tone: '#5B6B7B', province: 'dong-nai', region: 'Đông Nam Bộ',
    address: 'KM 12 Quốc lộ 1A, xã Xuân Lộc, Đồng Nai', phone: '0251 3871 012', lat: 10.9311, lng: 107.4096,
    hours: '7:00 – 17:00, Thứ 2 – Thứ 7', fulfillment: ['pickup', 'delivery'], cover: 'cover-bigbags', priceFactor: 0.95,
    bio: 'Kho tổng phân bón bao lớn, giao xe tải cho nhà vườn sầu riêng, cao su, điều. Giá tốt khi mua từ 20 bao.',
    products: ['npk20', 'npk16', 'urea', 'dap', 'kcl', 'trungluong', 'lan', 'voi', 'uhoai'], sale: ['kcl'], out: ['lan'],
    buy: [['dieu', 'Thu mua hạt điều thô', 31500, 50000]],
    verified: true, stars: [5, 4, 4, 5], delivery: { radius: 80, fee: 'per_trip', amount: 150000 } },
  { slug: 'tay-bac-xanh', name: 'HTX Vật tư Tây Bắc Xanh', initials: 'TB', tone: '#0288D1', province: 'lao-cai', region: 'Trung du và miền núi phía Bắc',
    address: '56 Hoàng Liên, P. Lào Cai, Lào Cai', phone: '0214 3820 056', lat: 22.4856, lng: 103.9707,
    hours: '7:30 – 17:00, Thứ 2 – Chủ nhật', fulfillment: ['pickup', 'at_dealer'], cover: 'cover-rice-terraces', priceFactor: 1.06,
    bio: 'Hợp tác xã cung ứng phân hữu cơ, phân trùn quế và vôi cho lúa nước, chè, cây ăn quả vùng cao.',
    products: ['uhoai', 'trunque', 'visinh', 'voi', 'lan', 'npk16', 'urea', 'npkla'], sale: ['trunque'], out: [],
    verified: false, stars: [5, 4], delivery: null },
  // Đại lý thu mua nông sản (lúa, sắn, ngô, sầu riêng, điều, cao su) kèm bán giống và phân.
  { slug: 'lua-gao-my-thanh', name: 'Đại lý Lúa gạo Mỹ Thạnh', initials: 'MT', tone: '#2E7D32', province: 'vinh-long', region: 'Đồng bằng sông Cửu Long',
    address: '78 Quốc lộ 53, xã Trà Ôn, Vĩnh Long', phone: '0270 3771 078', lat: 9.9697, lng: 105.9203,
    hours: '5:30 – 18:00 hằng ngày', fulfillment: ['pickup', 'delivery', 'at_dealer'], cover: 'cover-rice-sunrise', priceFactor: 1.0,
    bio: 'Thu mua lúa tươi tại ruộng bằng ghe và xe tải, cân điện tử, trả tiền ngay. Cung ứng lúa giống và phân bón theo vụ.',
    products: ['luagiong', 'urea', 'dap', 'npk16', 'kcl', 'voi'], sale: ['luagiong'], out: [],
    buy: [['lua', 'Thu mua lúa OM18 tươi tại ruộng', 7800, 200000], ['gao', 'Thu mua gạo nguyên liệu OM5451', 11500, 80000]],
    verified: true, stars: [5, 5, 4, 5], delivery: { radius: 25, fee: 'free' } },
  { slug: 'san-tan-chau', name: 'Cơ sở Thu mua Sắn Tân Châu', initials: 'TC', tone: '#B45309', province: 'tay-ninh', region: 'Đông Nam Bộ',
    address: 'Tổ 5, ấp Thạnh Hiệp, xã Tân Châu, Tây Ninh', phone: '0276 3875 105', lat: 11.5640, lng: 106.1700,
    hours: '6:00 – 17:30, Thứ 2 – Chủ nhật', fulfillment: ['pickup', 'delivery'], cover: 'cover-cassava', priceFactor: 0.98,
    bio: 'Thu mua sắn tươi (củ mì) giao nhà máy tinh bột, nhận cân tại rẫy từ 5 tấn. Có hom giống KM94 và phân bón cho sắn.',
    products: ['homsan', 'npk16', 'kcl', 'urea', 'uhoai'], sale: ['homsan'], out: [],
    buy: [['san', 'Thu mua sắn tươi trữ bột 28%+', 2900, 500000], ['san', 'Thu mua sắn lát khô', 6200, 100000]],
    verified: true, stars: [4, 5, 4, 4, 5], delivery: { radius: 40, fee: 'per_trip', amount: 80000 } },
  { slug: 'nong-san-ea-kar', name: 'Đại lý Nông sản Ea Kar', initials: 'EK', tone: '#0288D1', province: 'dak-lak', region: 'Tây Nguyên',
    address: '215 Nguyễn Tất Thành, xã Ea Kar, Đắk Lắk', phone: '0262 3625 215', lat: 12.8100, lng: 108.4500,
    hours: '6:30 – 18:00 hằng ngày', fulfillment: ['pickup', 'delivery', 'at_dealer'], cover: 'cover-maize-2', priceFactor: 1.01,
    bio: 'Thu mua ngô hạt, sắn tươi và đậu nành vùng Ea Kar – Krông Năng. Sấy ngô miễn phí cho hộ bán trên 3 tấn.',
    products: ['ngogiong', 'homsan', 'npk16', 'urea', 'kcl', 'lan'], sale: ['ngogiong'], out: [],
    buy: [['ngo', 'Thu mua ngô hạt khô (ẩm ≤ 15%)', 6400, 300000], ['san', 'Thu mua sắn tươi tại rẫy', 2750, 300000], ['dau-nanh', 'Thu mua đậu nành hạt', 14500, 30000]],
    verified: true, stars: [5, 4, 5, 4], delivery: { radius: 35, fee: 'per_trip', amount: 50000 } },
  { slug: 'ngo-san-mai-son', name: 'HTX Ngô – Sắn Mai Sơn', initials: 'MS', tone: '#7B4FD6', province: 'son-la', region: 'Trung du và miền núi phía Bắc',
    address: 'Tiểu khu 4, xã Mai Sơn, Sơn La', phone: '0212 3843 044', lat: 21.1700, lng: 104.0300,
    hours: '7:00 – 17:00, Thứ 2 – Thứ 7', fulfillment: ['pickup', 'at_dealer'], cover: 'cover-maize', priceFactor: 1.05,
    bio: 'Hợp tác xã bao tiêu ngô, sắn cho xã viên vùng cao, ứng trước giống và phân bón đầu vụ.',
    products: ['ngogiong', 'homsan', 'lan', 'npk16', 'voi'], sale: [], out: [],
    buy: [['ngo', 'Bao tiêu ngô hạt cho xã viên', 6200, 150000], ['san', 'Thu mua sắn tươi giao nhà máy Mai Sơn', 2500, 200000]],
    verified: false, stars: [4, 5, 4], delivery: null },
  { slug: 'sau-rieng-cai-mon', name: 'Vựa Sầu riêng Cái Mơn', initials: 'CM', tone: '#E08A00', province: 'vinh-long', region: 'Đồng bằng sông Cửu Long',
    address: 'Ấp Tân Thành, xã Chợ Lách, Vĩnh Long', phone: '0275 3871 199', lat: 10.2400, lng: 106.1300,
    hours: '5:00 – 20:00 hằng ngày (mùa vụ)', fulfillment: ['pickup', 'delivery'], cover: 'cover-durian', priceFactor: 1.03,
    bio: 'Vựa thu mua sầu riêng Ri6, Monthong xuất khẩu, cắt tại vườn. Bán phân hữu cơ và dinh dưỡng nuôi trái.',
    products: ['uhoai', 'trunque', 'kcl', 'trungluong', 'bonlalong', 'npk20'], sale: ['trungluong'], out: [],
    buy: [['sau-rieng', 'Thu mua sầu riêng Ri6 loại 1 tại vườn', 78000, 50000], ['sau-rieng', 'Thu mua sầu riêng Monthong xuất khẩu', 95000, 50000], ['xoai', 'Thu mua xoài cát Hòa Lộc', 32000, 20000]],
    verified: true, stars: [5, 5, 5, 4, 5], delivery: { radius: 30, fee: 'free' } },
  { slug: 'dieu-cao-su-dong-xoai', name: 'Đại lý Điều – Cao su Đồng Xoài', initials: 'ĐX', tone: '#5B6B7B', province: 'dong-nai', region: 'Đông Nam Bộ',
    address: '402 Phú Riềng Đỏ, P. Đồng Xoài, Đồng Nai', phone: '0271 3880 402', lat: 11.5350, lng: 106.8830,
    hours: '6:30 – 17:30, Thứ 2 – Chủ nhật', fulfillment: ['pickup', 'delivery', 'at_dealer'], cover: 'cover-rubber', priceFactor: 0.99,
    bio: 'Thu mua hạt điều thô và mủ cao su tại vườn, cân điện tử có kiểm định. Phân bón chuyên dùng cho điều và cao su.',
    products: ['npk20', 'npk16', 'urea', 'kcl', 'lan', 'uhoai'], sale: ['npk20'], out: [],
    buy: [['dieu', 'Thu mua hạt điều thô (tỷ lệ nhân ≥ 28%)', 32000, 100000], ['cao-su', 'Thu mua mủ cao su nước', 15500, 80000]],
    verified: true, stars: [4, 4, 5, 4], delivery: { radius: 45, fee: 'per_trip', amount: 70000 } },
];

const RATERS = [
  ['farmer-rater-1@agrilink.vn', 'Trần Văn Bình · Demo', '0905 111 201'],
  ['farmer-rater-2@agrilink.vn', 'Lê Thị Mai · Demo', '0905 111 202'],
  ['farmer-rater-3@agrilink.vn', 'Phạm Quốc Huy · Demo', '0905 111 203'],
];
const COMMENTS = {
  5: ['Hàng đúng như mô tả, giao nhanh, đại lý tư vấn nhiệt tình.', 'Bao còn nguyên tem, giá tốt hơn chỗ khác.', 'Mua nhiều lần rồi, rất yên tâm.'],
  4: ['Hàng ổn, giao trễ nửa ngày nhưng có báo trước.', 'Giá hợp lý, cửa hàng hơi đông phải chờ.'],
  3: ['Hàng đúng loại nhưng phải tự chở về, chưa có giao tận nơi.'],
};
const round = (v) => Math.round(v / 1000) * 1000;
/** Số kg mỗi đơn vị bán đọc từ tên ("bao 50kg" → 50) để POS nhập theo tấn/tạ/kg; null nếu không cân được. */
const kgFromName = (name) => {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*kg\)/i);
  return m ? Number(m[1].replace(',', '.')) : null;
};

/** Logo chữ viết tắt trên nền màu của đại lý (không dùng thương hiệu thật). */
const logoSvg = (initials, tone) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="112" fill="${tone}"/>
    <path d="M150 360c40-120 130-190 250-200-20 110-90 200-210 215" fill="#ffffff" opacity=".18"/>
    <text x="256" y="300" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="200" font-weight="700" fill="#ffffff">${initials}</text>
  </svg>`,
);

async function main() {
  const password = process.env.SEED_FARMER_PASSWORD;
  if (!password)
    throw new Error('Set SEED_FARMER_PASSWORD for local-only demo accounts.');
  const hash = await bcrypt.hash(password, 10);
  for (const dir of ['logos', 'covers', 'listings']) mkdirSync(join(UPLOADS, dir), { recursive: true });

  const client = new Client(config);
  await client.connect();
  try {
    await client.query('BEGIN');
    // Đăng nhập bằng email hoặc username; username = SĐT di động giống tài khoản đăng ký thật.
    const userId = async (email, name, role, org, phone) => {
      const username = phone.replace(/\D/g, '');
      await client.query(
        `INSERT INTO users(email,username,"fullName",password,role,"isActive","organizationId",phone) VALUES($1,$2,$3,$4,$5,true,$6,$7)
         ON CONFLICT(email) DO UPDATE SET username=COALESCE(users.username,EXCLUDED.username),phone=COALESCE(users.phone,EXCLUDED.phone)`,
        [email, username, name, hash, role, org, phone],
      );
      return (await client.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
    };
    const crops = new Map((await client.query('SELECT id,code,commodity_type FROM agri_crops')).rows.map((r) => [r.code, r]));
    const raters = [];
    for (const [email, name, phone] of RATERS) raters.push({ id: await userId(email, name, 'farmer', null, phone), name, phone });

    for (const [di, d] of DEALERS.entries()) {
      const orgId = uid('org:' + d.slug);
      const logoUrl = `/uploads/logos/${orgId}-demo.webp`;
      const coverUrl = `/uploads/covers/${orgId}-demo.webp`;
      await sharp(logoSvg(d.initials, d.tone)).webp({ quality: 90 }).toFile(join(UPLOADS, logoUrl.slice(9)));
      copyFileSync(join(ASSETS, d.cover + '.webp'), join(UPLOADS, coverUrl.slice(9)));
      await client.query(
        `INSERT INTO agrilink_organizations(id,name,bio,region,address,phone,logo_url,cover_url,opening_hours,fulfillment_options,province_code,lat,lng,marketplace_enabled,community_enabled)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,true)
         ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,bio=EXCLUDED.bio,region=EXCLUDED.region,address=EXCLUDED.address,phone=EXCLUDED.phone,
           logo_url=EXCLUDED.logo_url,cover_url=EXCLUDED.cover_url,opening_hours=EXCLUDED.opening_hours,fulfillment_options=EXCLUDED.fulfillment_options,
           province_code=EXCLUDED.province_code,lat=EXCLUDED.lat,lng=EXCLUDED.lng,marketplace_enabled=true`,
        [orgId, d.name, d.bio + '\n\n[Đại lý mẫu để trải nghiệm AgriLink]', d.region, d.address, d.phone, logoUrl, coverUrl, d.hours, d.fulfillment, d.province, d.lat, d.lng],
      );
      const owner = await userId(`dealer-${d.slug}@agrilink.vn`, `Chủ ${d.name} · Demo`, 'owner', orgId, `0912 000 1${String(di + 1).padStart(2, '0')}`);
      await client.query(
        'INSERT INTO agrilink_memberships(user_id,organization_id,can_publish) VALUES($1,$2,true) ON CONFLICT DO NOTHING',
        [owner, orgId],
      );

      const categoryId = uid(`category:${d.slug}`);
      await client.query(
        `INSERT INTO categories(id,name,slug,description,"organizationId") VALUES($1,'Phân bón','phan-bon','Phân bón các loại',$2)
         ON CONFLICT(id) DO NOTHING`,
        [categoryId, orgId],
      );

      const offers = [];
      for (const [pi, code] of d.products.entries()) {
        const item = CATALOG[code];
        const productId = uid(`product:${d.slug}:${code}`);
        const offerId = uid(`offer:${d.slug}:${code}`);
        const price = round(item.price * d.priceFactor);
        const stock = d.out.includes(code) ? 0 : 20 + ((di * 7 + pi * 13) % 180);
        const images = item.images.map((key, n) => {
          const url = `/uploads/listings/${orgId}-${productId}-demo-${n + 1}.webp`;
          copyFileSync(join(ASSETS, key + '.webp'), join(UPLOADS, url.slice(9)));
          return url;
        });
        await client.query(
          `INSERT INTO products(id,sku,name,"categoryId",unit,"purchasePrice","sellingPrice","stockQuantity","minStock",description,"imageUrl","isActive","organizationId","baseUnit","conversionRate")
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,5,$9,$10,true,$11,$12,$13)
           ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,unit=EXCLUDED.unit,"purchasePrice"=EXCLUDED."purchasePrice","sellingPrice"=EXCLUDED."sellingPrice",
             "baseUnit"=EXCLUDED."baseUnit","conversionRate"=EXCLUDED."conversionRate",
             "stockQuantity"=EXCLUDED."stockQuantity",description=EXCLUDED.description,"imageUrl"=EXCLUDED."imageUrl","isActive"=true,"updatedAt"=now()`,
          [productId, `DEMO-${code.toUpperCase()}`, item.name, categoryId, item.unit, round(item.cost * d.priceFactor), price, stock, item.description, images[0], orgId,
            kgFromName(item.name) ? 'kg' : null, kgFromName(item.name)],
        );
        const onSale = d.sale.includes(code);
        await client.query(
          `INSERT INTO agrilink_offers(id,organization_id,kind,product_id,title,unit,price,active,description,images,sale_price,sale_ends_at)
           VALUES($1,$2,'sale',$3,'','',NULL,true,$4,$5::jsonb,$6,$7)
           ON CONFLICT(id) DO UPDATE SET active=true,description=EXCLUDED.description,images=EXCLUDED.images,
             sale_price=EXCLUDED.sale_price,sale_ends_at=EXCLUDED.sale_ends_at,updated_at=now()`,
          [offerId, orgId, productId, item.description, JSON.stringify(images),
            onSale ? round(price * 0.92) : null, onSale ? new Date(Date.now() + 21 * 86400000) : null],
        );
        offers.push({ offerId, productId, name: item.name, unit: item.unit, price });
      }

      if (d.delivery)
        await client.query(
          `INSERT INTO agrilink_dealer_services(organization_id,kind,active,area_mode,radius_km,fee_mode,fee_amount,lead_time_hours,note)
           VALUES($1,'supply_delivery',true,'radius',$2,$3,$4,24,'Giao trong ngày với đơn đặt trước 10 giờ sáng.')
           ON CONFLICT(organization_id,kind) DO UPDATE SET active=true,radius_km=EXCLUDED.radius_km,fee_mode=EXCLUDED.fee_mode,fee_amount=EXCLUDED.fee_amount`,
          [orgId, d.delivery.radius, d.delivery.fee, d.delivery.amount || 0],
        );

      // Tin thu mua: giá cập nhật lúc seed (tin quá 48 giờ sẽ ẩn khỏi tìm kiếm — chạy lại script để làm mới).
      for (const [bi, [cropCode, title, price, maxKg]] of (d.buy || []).entries()) {
        const crop = crops.get(cropCode);
        if (!crop) throw new Error(`Không có cây trồng "${cropCode}" trong agri_crops — chạy npm run agri:setup trước.`);
        await client.query(
          `INSERT INTO agrilink_offers(id,organization_id,kind,product_id,title,unit,price,active,crop_id,commodity_type,max_quantity_kg,valid_until,price_updated_at,updated_at)
           VALUES($1,$2,'buy',NULL,$3,'kg',$4,true,$5,$6,$7,(now() + interval '30 days')::date,now(),now())
           ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,price=EXCLUDED.price,active=true,crop_id=EXCLUDED.crop_id,commodity_type=EXCLUDED.commodity_type,
             max_quantity_kg=EXCLUDED.max_quantity_kg,valid_until=EXCLUDED.valid_until,price_updated_at=now(),updated_at=now()`,
          [uid(`buy:${d.slug}:${bi}`), orgId, title, price, crop.id, crop.commodity_type, maxKg],
        );
      }

      // Nông sản đại lý thu mua trong AgriPOS = nông sản trong tin thu mua (mã: commodity_type hoặc crop code).
      const commodityKeys = [...new Set((d.buy || []).map(([code]) => crops.get(code)).map((c) => c.commodity_type || c.code))];
      if (!commodityKeys.length) commodityKeys.push('lua', 'ngo');
      const updated = await client.query(
        'UPDATE store_settings SET "storeName"=$2,address=$3,phone=$4,"provinceCode"=$5,commodities=$6 WHERE "organizationId"=$1',
        [orgId, d.name, d.address, d.phone, d.province, commodityKeys],
      );
      if (!updated.rowCount)
        await client.query(
          'INSERT INTO store_settings("storeName",address,phone,"provinceCode",commodities,"organizationId") VALUES($2,$3,$4,$5,$6,$1)',
          [orgId, d.name, d.address, d.phone, d.province, commodityKeys],
        );

      if (d.verified)
        await client.query(
          `INSERT INTO agrilink_dealer_verifications(organization_id,status,legal_name,tax_code,business_address,submitted_by,reviewed_at,note)
           VALUES($1,'verified',$2,$3,$4,$5,now(),'Hồ sơ mẫu (demo)')
           ON CONFLICT(organization_id) DO UPDATE SET status='verified'`,
          [orgId, `Hộ kinh doanh ${d.name}`, `80${String(10000000 + di * 1234567).slice(0, 8)}`, d.address, owner],
        );

      // Đơn đã hoàn tất + đánh giá để có số sao trên thẻ đại lý.
      for (const [oi, stars] of d.stars.entries()) {
        const orderId = uid(`order:${d.slug}:${oi}`);
        const rater = raters[oi % raters.length];
        const offer = offers[(oi * 3) % offers.length];
        const qty = 2 + ((di + oi) % 6);
        const total = offer.price * qty;
        const daysAgo = 5 + oi * 9 + di;
        const inserted = await client.query(
          `INSERT INTO agrilink_orders(id,"organizationId",code,"requesterId",kind,status,fulfillment,"contactName","contactPhone",
             "estimatedTotal","finalTotal","confirmedAt","completedAt","createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'buy','completed','pickup',$5,$6,$7,$7,
             now()-make_interval(days => $8),now()-make_interval(days => $8 - 1),now()-make_interval(days => $8),now()-make_interval(days => $8 - 1))
           ON CONFLICT(id) DO NOTHING RETURNING id`,
          [orderId, orgId, `DEMO-${di + 1}${oi + 1}`, rater.id, rater.name, rater.phone, total, daysAgo],
        );
        if (!inserted.rowCount) continue;
        await client.query(
          `INSERT INTO agrilink_order_items("organizationId","orderId","offerId","productId","itemName",unit,quantity,"unitPrice","finalQuantity","finalUnitPrice")
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$8)`,
          [orgId, orderId, offer.offerId, offer.productId, offer.name, offer.unit, qty, offer.price],
        );
        const comments = COMMENTS[stars] || COMMENTS[4];
        await client.query(
          `INSERT INTO agrilink_order_ratings(order_id,organization_id,rater_id,stars,on_time,as_described,comment,created_at)
           VALUES($1,$2,$3,$4,$5,true,$6,now()-make_interval(days => $7)) ON CONFLICT(order_id) DO NOTHING`,
          [orderId, orgId, rater.id, stars, stars >= 4, comments[oi % comments.length], daysAgo - 2],
        );
      }
      console.log(`✓ ${d.name}: ${offers.length} sản phẩm, ${(d.buy || []).length} tin thu mua, ${d.stars.length} đánh giá${d.verified ? ', đã xác minh' : ''}`);
    }
    await client.query('COMMIT');
    console.log('Demo accounts: dealer-<slug>@agrilink.vn (or phone 0912000101…108) and farmer-rater-1..3@agrilink.vn (0905111201…203); password = SEED_FARMER_PASSWORD, existing passwords unchanged.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
