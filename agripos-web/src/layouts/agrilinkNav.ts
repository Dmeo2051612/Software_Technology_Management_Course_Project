export type NavItem = {
  label: string;
  path: string;
  icon: string;
  badgeKey?: 'cart' | 'pendingOrders' | 'messages' | 'complaints';
  /** Màu icon trong menu kênh đại lý (xem agrilink-gray.css mục 20). */
  tone?: string;
  /** Icon màu Fluent (assets/img/fluent-color) dùng trong menu kênh đại lý. */
  colorIcon?: string;
};

const buyer: NavItem[] = [
  { label: 'Khám phá đại lý', path: '/agrilink', icon: 'ti ti-building-store' },
  { label: 'Giỏ hàng', path: '/agrilink/gio-hang', icon: 'ti ti-shopping-cart', badgeKey: 'cart' },
  { label: 'Đơn của tôi', path: '/agrilink/don-cua-toi', icon: 'ti ti-receipt' },
  { label: 'Cộng đồng', path: '/community', icon: 'ti ti-users' },
];
const manage: NavItem[] = [
  { label: 'Tổng quan', path: '/agrilink/quan-ly', icon: 'ti ti-layout-dashboard', tone: 'blue', colorIcon: 'data-trending' },
  {
    label: 'Đơn hàng',
    path: '/agrilink/quan-ly/don',
    icon: 'ti ti-clipboard-list',
    badgeKey: 'pendingOrders',
    tone: 'green',
    colorIcon: 'clipboard-task',
  },
  { label: 'Tin nhắn', path: '/agrilink/quan-ly/tin-nhan', icon: 'ti ti-message-circle', badgeKey: 'messages', tone: 'sky', colorIcon: 'chat' },
  { label: 'Khiếu nại', path: '/agrilink/quan-ly/khieu-nai', icon: 'ti ti-alert-triangle', badgeKey: 'complaints', tone: 'red', colorIcon: 'warning' },
  { label: 'Sản phẩm đăng bán', path: '/agrilink/quan-ly/san-pham', icon: 'ti ti-package', tone: 'amber', colorIcon: 'toolbox' },
  { label: 'Voucher', path: '/agrilink/quan-ly/voucher', icon: 'ti ti-ticket', tone: 'rose', colorIcon: 'gift-card' },
  { label: 'Tin thu mua', path: '/agrilink/quan-ly/thu-mua', icon: 'ti ti-plant', tone: 'green', colorIcon: 'megaphone-loud' },
  { label: 'Nguồn hàng gợi ý', path: '/agrilink/quan-ly/nguon-hang', icon: 'ti ti-sparkles', tone: 'violet', colorIcon: 'search-sparkle' },
  { label: 'Dịch vụ & lịch', path: '/agrilink/quan-ly/dich-vu', icon: 'ti ti-calendar', tone: 'teal', colorIcon: 'calendar-clock' },
  { label: 'Thông tin đại lý', path: '/agrilink/quan-ly/thong-tin', icon: 'ti ti-building-store', tone: 'amber', colorIcon: 'building-store' },
  { label: 'Đánh giá', path: '/agrilink/quan-ly/danh-gia', icon: 'ti ti-star', tone: 'gold', colorIcon: 'star' },
  { label: 'Xác minh', path: '/agrilink/quan-ly/xac-minh', icon: 'ti ti-rosette-discount-check', tone: 'blue', colorIcon: 'shield-checkmark' },
  { label: 'Hỗ trợ', path: '/agrilink/quan-ly/ho-tro', icon: 'ti ti-lifebuoy', tone: 'slate', colorIcon: 'headset' },
];
/** Mục thu ngân được dùng: đơn hàng, tin nhắn, khiếu nại, hỗ trợ. */
const CASHIER_PATHS = [
  '/agrilink/quan-ly/don',
  '/agrilink/quan-ly/tin-nhan',
  '/agrilink/quan-ly/khieu-nai',
  '/agrilink/quan-ly/ho-tro',
];
const farmer: NavItem[] = [
  { label: 'Trang chủ', path: '/farmer', icon: 'ti ti-home' },
  { label: 'Tạo yêu cầu', path: '/farmer/requests/new', icon: 'ti ti-plus' },
  { label: 'Yêu cầu của tôi', path: '/farmer/requests', icon: 'ti ti-file-text' },
  { label: 'Giao dịch', path: '/farmer/transactions', icon: 'ti ti-arrows-exchange' },
  { label: 'Hồ sơ', path: '/farmer/profile', icon: 'ti ti-user' },
];
export function agrilinkNav(role: string | undefined): {
  buyer: NavItem[];
  manage: NavItem[];
  farmer: NavItem[];
} {
  return {
    buyer,
    manage: role === 'owner' ? manage : role === 'manager' ? manage.filter(item => item.label !== 'Xác minh') : role === 'cashier' ? manage.filter(item => CASHIER_PATHS.includes(item.path)) : [],
    farmer: role === 'farmer' ? farmer : [],
  };
}

/** Tab ở giữa header người mua đang ứng với trang hiện tại (null nếu không có). */
export type BuyerTab = 'explore' | 'community' | 'orders';
export function buyerTab(pathname: string): BuyerTab | null {
  if (pathname === '/agrilink' || pathname.startsWith('/agrilink/dai-ly')) return 'explore';
  if (pathname.startsWith('/community')) return 'community';
  if (pathname.startsWith('/agrilink/nhu-cau') || pathname.startsWith('/agrilink/don-cua-toi')) return 'orders';
  return null;
}

export type AppMenuItem = { label: string; hint: string; icon: string; path?: string; action?: 'agripos' };
export type AppMenuSection = { title: string; items: AppMenuItem[] };

/** Menu lưới (kiểu Facebook) liệt kê mọi chức năng AgriLink theo nhóm. */
export function agrilinkAppMenu(role: string | undefined, hasDealerChannel: boolean): AppMenuSection[] {
  const account: AppMenuItem[] = [
    { label: 'Trung tâm hỗ trợ', hint: 'Gửi yêu cầu, xem câu hỏi thường gặp', icon: 'ti ti-lifebuoy', path: '/agrilink/ho-tro' },
  ];
  if (hasDealerChannel)
    account.push({ label: 'Kênh đại lý', hint: 'Quản lý đơn, sản phẩm và khách hàng', icon: 'ti ti-building-warehouse', path: '/agrilink/quan-ly' });
  if (role && role !== 'farmer')
    account.push({ label: 'Về AgriPOS', hint: 'Mở phần mềm bán hàng của đại lý', icon: 'ti ti-arrow-up-right', action: 'agripos' });
  return [
    {
      title: 'Mua bán',
      items: [
        { label: 'Khám phá đại lý', hint: 'Tìm vật tư và tin thu mua gần bạn', icon: 'ti ti-building-store', path: '/agrilink' },
        { label: 'Tôi muốn bán / mua', hint: 'Đăng nhu cầu, nhận đề nghị từ đại lý', icon: 'ti ti-sparkles', path: '/agrilink/ban-mua' },
        { label: 'Nhu cầu & đơn của tôi', hint: 'Theo dõi đề nghị và đơn hàng', icon: 'ti ti-clipboard-list', path: '/agrilink/nhu-cau' },
        { label: 'Giỏ hàng', hint: 'Vật tư đã chọn theo từng đại lý', icon: 'ti ti-shopping-cart', path: '/agrilink/gio-hang' },
      ],
    },
    {
      title: 'Kết nối',
      items: [
        { label: 'Cộng đồng', hint: 'Hỏi đáp, chia sẻ kinh nghiệm canh tác', icon: 'ti ti-users-group', path: '/community' },
        { label: 'Tin nhắn', hint: 'Trò chuyện với đại lý', icon: 'ti ti-message-circle', path: '/agrilink/tin-nhan' },
        { label: 'Thông báo', hint: 'Cập nhật đơn hàng và cộng đồng', icon: 'ti ti-bell', path: '/notifications' },
      ],
    },
    { title: 'Hỗ trợ & tài khoản', items: account },
  ];
}
