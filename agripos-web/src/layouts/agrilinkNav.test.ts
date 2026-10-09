import { describe, expect, it } from 'vitest';
import { agrilinkAppMenu, agrilinkNav, buyerTab } from './agrilinkNav';

describe('agrilinkNav', () => {
  it('shows buyer navigation to everyone', () => {
    expect(agrilinkNav('farmer').buyer.map((x) => x.label)).toEqual([
      'Khám phá đại lý',
      'Giỏ hàng',
      'Đơn của tôi',
      'Cộng đồng',
    ]);
    expect(agrilinkNav('farmer').manage).toEqual([]);
  });
  it('shows the dealer sections and keeps verification owner-only', () => {
    const owner = agrilinkNav('owner').manage.map((item) => item.label);
    const manager = agrilinkNav('manager').manage.map((item) => item.label);
    expect(owner).toEqual([
      'Tổng quan', 'Đơn hàng', 'Tin nhắn', 'Khiếu nại', 'Sản phẩm đăng bán', 'Voucher', 'Tin thu mua',
      'Nguồn hàng gợi ý', 'Dịch vụ & lịch', 'Thông tin đại lý', 'Đánh giá', 'Xác minh', 'Hỗ trợ',
    ]);
    expect(manager).toEqual(owner.filter((item) => item !== 'Xác minh'));
  });
  it('limits cashier management to orders, messages, complaints and support', () => {
    expect(agrilinkNav('cashier').manage.map((x) => x.label)).toEqual(['Đơn hàng', 'Tin nhắn', 'Khiếu nại', 'Hỗ trợ']);
  });
  it('keeps the farmer workspace separate from buyer pages', () => {
    expect(agrilinkNav('farmer').farmer.map((x) => x.label)).toEqual([
      'Trang chủ',
      'Tạo yêu cầu',
      'Yêu cầu của tôi',
      'Giao dịch',
      'Hồ sơ',
    ]);
  });
});

describe('buyer header tabs', () => {
  it('marks the tab of the current page, including its detail pages', () => {
    expect(buyerTab('/agrilink')).toBe('explore');
    expect(buyerTab('/agrilink/dai-ly/d1')).toBe('explore');
    expect(buyerTab('/community/posts/p1')).toBe('community');
    expect(buyerTab('/agrilink/nhu-cau/i1')).toBe('orders');
    expect(buyerTab('/agrilink/don-cua-toi/o1')).toBe('orders');
    expect(buyerTab('/agrilink/gio-hang')).toBeNull();
  });
});

describe('agrilinkAppMenu', () => {
  const labels = (role?: string, dealer = false) =>
    agrilinkAppMenu(role, dealer).flatMap((s) => s.items.map((i) => i.label));
  it('groups every buyer feature for a farmer, without dealer or AgriPOS entries', () => {
    expect(agrilinkAppMenu('farmer', false).map((s) => s.title)).toEqual(['Mua bán', 'Kết nối', 'Hỗ trợ & tài khoản']);
    expect(labels('farmer')).toEqual([
      'Khám phá đại lý', 'Tôi muốn bán / mua', 'Nhu cầu & đơn của tôi', 'Giỏ hàng',
      'Cộng đồng', 'Tin nhắn', 'Thông báo',
      'Trung tâm hỗ trợ',
    ]);
  });
  it('adds the dealer channel for staff and the AgriPOS app for non-farmers', () => {
    expect(labels('owner', true)).toEqual(expect.arrayContaining(['Kênh đại lý', 'Về AgriPOS']));
    expect(labels('owner', false)).not.toContain('Kênh đại lý');
  });
});
