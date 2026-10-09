import { useState, type Dispatch, type SetStateAction } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import BrandMark from '../components/brand/BrandMark';
import { useAuthStore } from '../stores/authStore';
import { useMagnetic, useSlidingPill } from '../utils/motion';
import AgriLinkAccountMenu from './AgriLinkAccountMenu';
import AgriLinkAppMenu from './AgriLinkAppMenu';
import AgriLinkCartMenu from './AgriLinkCartMenu';
import AgriLinkMessagesMenu from './AgriLinkMessagesMenu';
import { agrilinkAppMenu, buyerTab, type BuyerTab } from './agrilinkNav';
import NotificationBell from './NotificationBell';

const TABS: { key: BuyerTab; label: string; icon: string; to: string }[] = [
  { key: 'explore', label: 'Khám phá đại lý', icon: 'ti ti-building-store', to: '/agrilink' },
  { key: 'community', label: 'Cộng đồng', icon: 'ti ti-users-group', to: '/community' },
  { key: 'orders', label: 'Đơn của tôi', icon: 'ti ti-clipboard-list', to: '/agrilink/nhu-cau' },
];

/**
 * Header phía người mua kiểu Facebook: logo + tìm kiếm | tab icon ở giữa
 * (rê chuột hiện tên) | nút bán/mua, menu lưới, giỏ, tin nhắn, thông báo, tài khoản.
 */
export default function AgriLinkBuyerHeader({
  hasDealerChannel,
  cartCount,
  chatUnread,
  unread,
  onUnreadChange,
  onMessagesChanged,
}: {
  hasDealerChannel: boolean;
  cartCount: number;
  chatUnread: number;
  unread: number;
  onUnreadChange: Dispatch<SetStateAction<number>>;
  onMessagesChanged: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const [search, setSearch] = useState('');
  const active = buyerTab(pathname);
  // Gạch chân trượt giữa các tab (mockup 53 · M6), nút bán/mua hút nhẹ theo chuột (M10).
  const { barRef: tabsBarRef, pillRef: tabsPillRef } = useSlidingPill<HTMLElement>(active ?? '', ':scope > .active');
  const ctaRef = useMagnetic<HTMLAnchorElement>();

  return (
    <header className="agrilink-header agrilink-buyer-header alh">
      <div className="alh-left">
        <Link to="/agrilink" className="agrilink-logo text-decoration-none" aria-label="AgriLink — trang chủ">
          <BrandMark className="agrilink-logo-mark" size={40} />
          <span className="alh-wordmark">
            Agri<span className="agrilink-logo-accent">Link</span>
          </span>
        </Link>
        <form
          className="alh-search"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/agrilink?q=${encodeURIComponent(search)}`);
          }}
        >
          <i className="ti ti-search" aria-hidden="true" />
          <input
            aria-label="Tìm đại lý, vật tư, bài viết"
            placeholder="Tìm kiếm trên AgriLink"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>

      <nav className="alh-tabs agl-underline has-pill" aria-label="Điều hướng AgriLink" ref={tabsBarRef}>
        <span ref={tabsPillRef} className="agri-tab-pill" aria-hidden="true" />
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            to={tab.to}
            className={`alh-tab${active === tab.key ? ' active' : ''}`}
            aria-label={tab.label}
            aria-current={active === tab.key ? 'page' : undefined}
          >
            <i className={tab.icon} aria-hidden="true" />
            <span className="alh-tip" aria-hidden="true">{tab.label}</span>
          </Link>
        ))}
      </nav>

      <div className="alh-right">
        <NavLink ref={ctaRef} className="btn btn-primary alh-cta" to="/agrilink/ban-mua" aria-label="Tôi muốn bán / mua">
          <i className="ti ti-sparkles" aria-hidden="true" />
          <span className="alh-cta-text">Tôi muốn bán / mua</span>
        </NavLink>
        {hasDealerChannel && (
          <NavLink className="alh-circle" to="/agrilink/quan-ly" aria-label="Kênh đại lý">
            <i className="ti ti-building-warehouse" aria-hidden="true" />
            <span className="alh-tip" aria-hidden="true">Kênh đại lý</span>
          </NavLink>
        )}
        <AgriLinkAppMenu sections={agrilinkAppMenu(role, hasDealerChannel)} />
        <AgriLinkCartMenu count={cartCount} />
        <AgriLinkMessagesMenu side="buyer" unread={chatUnread} onChanged={onMessagesChanged} />
        <div className="alh-has-tip">
          <NotificationBell unread={unread} onUnreadChange={onUnreadChange} />
          <span className="alh-tip" aria-hidden="true">Thông báo</span>
        </div>
        <AgriLinkAccountMenu channel="buyer" />
      </div>
    </header>
  );
}
