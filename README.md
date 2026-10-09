# AgriLink — mã nguồn

AgriLink là sàn kết nối nông dân với đại lý nông sản/vật tư, chạy chung nền tảng với AgriPOS:
cộng đồng, đăng nhu cầu "Tôi muốn bán/mua" (ghép đại lý tự động), gian hàng và tin thu mua của đại lý,
đặt hàng, nhắn tin, khiếu nại, đánh giá, xác minh đại lý, voucher.

Gói này **chỉ chứa phần code AgriLink**, giữ nguyên đường dẫn trong hai repo gốc. Nó dựa vào phần lõi AgriPOS
(xác thực, tổ chức, sản phẩm, khách hàng, đơn POS…) nên không tự chạy riêng được; đặt các thư mục vào đúng vị trí
trong `agripos-api` và `agripos-web` để build.

## Cấu trúc

```
agripos-api/                       Backend NestJS + PostgreSQL
  src/agrilink-intents/            Nhu cầu bán/mua, bộ phân tích câu (luật / DeepSeek / Gemini), chấm điểm ghép đại lý
  src/agrilink-orders/             Đơn AgriLink, đặt lịch, hoàn tất đơn sang POS
  src/agrilink-messaging/          Nhắn tin nông dân – đại lý, khiếu nại
  src/marketplace/                 Gian hàng, tin thu mua, sản phẩm đăng bán, voucher, uy tín & xác minh
  src/community/                   Cộng đồng (bài viết, bình luận, kiểm duyệt, thông báo)
  src/migrations/                  SQL tạo bảng AgriLink / marketplace / community
  scripts/                         Script setup DB, dữ liệu demo, smoke test
  .env.agrilink.example            Các biến môi trường cần (để trống giá trị)
agripos-web/                       Frontend React + Vite
  src/feature-module/agrilink/     Trang người mua (buyer), quản lý đại lý (manage), nhắn tin, component dùng chung
  src/feature-module/community/    Trang cộng đồng, giá thị trường
  src/layouts/                     Khung giao diện AgriLink (header, menu, theme)
  src/services/, src/stores/       Gọi API AgriLink, giỏ hàng, theme
  public/brand/                    Logo AgriLink
```

## Thiết lập cơ sở dữ liệu (trong agripos-api)

```
npm run community:setup
npm run marketplace:setup
npm run agrilink:setup
npm run agrilink:intents-setup
npm run agrilink:booking-setup
npm run agrilink:trust-setup
npm run agrilink:listings-setup
npm run agrilink:cover-setup
npm run agrilink:messaging-setup
npm run agrilink:vouchers-setup
```

Smoke test (cần API đang chạy và mật khẩu demo trong `.env`): `npm run agrilink:smoke`,
`npm run agrilink:matching-smoke`, `npm run agrilink:vouchers-smoke`.

## Bảo mật

Gói không có file `.env`, mật khẩu, khóa API, dữ liệu hay ảnh tải lên. Mọi bí mật đều đọc từ biến môi trường.
Số điện thoại, email `*@agrilink.vn` trong test và script demo là dữ liệu giả.
