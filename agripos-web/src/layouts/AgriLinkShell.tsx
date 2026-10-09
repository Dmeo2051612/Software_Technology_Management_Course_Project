import { fluentColorIcon } from '../assets/img/fluent-color';
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import api from '../services/api';
import { communityApi } from '../services/community.service';
import { useAuthStore } from '../stores/authStore';
import { openAppTab } from '../utils/openAppTab';
import { ToastHost } from '../components/ui';
import PreviewSprite from '../components/PreviewSprite';
import { agrilinkNav, type NavItem } from './agrilinkNav';
import { matchingApi } from '../services/agrilink-matching.service';
import NotificationBell from './NotificationBell';
import { messagingApi } from '../services/agrilink-messaging.service';
import type { UnreadCount } from '../services/agrilink-messaging.types';
import { usePolling } from '../feature-module/agrilink/messaging/usePolling';
import BrandMark from '../components/brand/BrandMark';
import AgriLinkAccountMenu from './AgriLinkAccountMenu';
import AgriLinkBuyerHeader from './AgriLinkBuyerHeader';
import AgriLinkMessagesMenu from './AgriLinkMessagesMenu';
import './AgriLinkShell.css';
import { useAgrilinkThemeEffect } from './useAgrilinkThemeEffect';
import './agrilink-gray.css';
import './agrilink-dark.css';
import './agrilink-motion.css';

export default function AgriLinkShell({ channel = 'buyer' }: { channel?: 'buyer' | 'dealer' }) {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const nav = agrilinkNav(user?.role);
  const theme = useAgrilinkThemeEffect();
  const [pending, setPending] = useState(0);
  const [leadCount, setLeadCount] = useState(0);
  const [unread, setUnread] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [messageUnread, setMessageUnread] = useState<UnreadCount>({ chat: 0, other: 0 });
  const inboxSide = channel === 'dealer' ? 'dealer' : 'buyer';
  const refreshMessages = useCallback(
    () => messagingApi.unread(inboxSide).then(setMessageUnread).catch(() => {}),
    [inboxSide],
  );
  useEffect(() => {
    void refreshMessages();
  }, [refreshMessages, pathname]);
  usePolling(refreshMessages, 30000);
  useEffect(() => {
    document.title = 'AgriLink';
  }, []);
  useEffect(() => {
    const refreshCart = () => {
      try {
        const raw = JSON.parse(localStorage.getItem('agrilink_cart_v1') || '{}');
        const carts = raw.state?.carts || raw.carts || {};
        setCartCount(
          Object.values(carts).reduce<number>(
            (sum, cart) =>
              sum +
              ((cart as { lines?: { quantity: number }[] }).lines || []).reduce(
                (n, line) => n + line.quantity,
                0,
              ),
            0,
          ),
        );
      } catch {
        setCartCount(0);
      }
    };
    refreshCart();
    window.addEventListener('storage', refreshCart);
    window.addEventListener('agrilink-cart-change', refreshCart);
    return () => {
      window.removeEventListener('storage', refreshCart);
      window.removeEventListener('agrilink-cart-change', refreshCart);
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      void communityApi
        .notifications()
        .then((r) => setUnread(r.unread))
        .catch(() => {});
      if (nav.manage.length)
        void api
          .get('/agrilink-manage/orders', { params: { status: 'pending', limit: 1 } })
          .then((r) => setPending(r.data.data.counts.pending))
          .catch(() => {});
      if (nav.manage.some(item => item.path === '/agrilink/quan-ly/nguon-hang'))
        void matchingApi.leads().then(items => setLeadCount(items.length)).catch(() => {});
    };
    refresh();
    const interval = window.setInterval(refresh, 60000);
    return () => window.clearInterval(interval);
  }, [nav.manage.length]);
  const allNav = [...nav.buyer, ...nav.manage, ...nav.farmer];
  const primaryNav = [
    ...nav.buyer.slice(0, 3),
    nav.manage.find((item) => item.path === '/agrilink/quan-ly/don') || nav.farmer[0],
    nav.buyer[3],
  ].filter((item): item is NavItem => !!item);
  const overflowNav = allNav.filter(
    (item) => !primaryNav.some((primary) => primary.path === item.path),
  );
  const communityView = pathname.startsWith('/community') || pathname === '/notifications';
  const wideView = communityView || pathname.startsWith('/agrilink/ban-mua') || pathname.startsWith('/agrilink/nhu-cau');
  const contentClass = [
    'agrilink-content',
    channel === 'buyer' && wideView ? 'agrilink-content-wide' : '',
    channel === 'buyer' && communityView ? 'agrilink-content-bleed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const badge = (item: NavItem) =>
    item.badgeKey === 'cart'
      ? cartCount
      : item.badgeKey === 'pendingOrders'
        ? pending
        : item.badgeKey === 'messages'
          ? messageUnread.chat
          : item.badgeKey === 'complaints'
            ? messageUnread.other
            : 0;
  return (
    <div className="agrilink-shell preview-scope" data-agl-theme={theme}>
      <PreviewSprite />
      <ToastHost />
      <div className="agrilink-main">
        {channel === 'buyer' ? (
          <AgriLinkBuyerHeader
            hasDealerChannel={nav.manage.length > 0}
            cartCount={cartCount}
            chatUnread={messageUnread.chat}
            unread={unread}
            onUnreadChange={setUnread}
            onMessagesChanged={() => void refreshMessages()}
          />
        ) : (
          <header className="agrilink-header alh alh-dealer">
            <div className="alh-left">
              <NavLink to="/agrilink/quan-ly" end className="agrilink-logo text-decoration-none">
                <BrandMark className="agrilink-logo-mark" size={40} />
                <span className="alh-wordmark">
                  Agri<span className="agrilink-logo-accent">Link</span>
                </span>
              </NavLink>
              <span className="alh-channel">
                <i className="ti ti-building-warehouse" aria-hidden="true" />
                Kênh đại lý
              </span>
            </div>
            <div />
            <div className="alh-right">
              <NavLink to="/agrilink" end className="alh-pill">
                <i className="ti ti-eye" aria-hidden="true" />
                Xem như người mua
              </NavLink>
              <AgriLinkMessagesMenu side="dealer" unread={messageUnread.chat} onChanged={() => void refreshMessages()} />
              <div className="alh-has-tip">
                <NotificationBell unread={unread} onUnreadChange={setUnread} />
                <span className="alh-tip" aria-hidden="true">
                  Thông báo
                </span>
              </div>
              <AgriLinkAccountMenu channel="dealer" />
            </div>
          </header>
        )}
        <div className={channel === 'dealer' ? 'agrilink-dealer-body' : ''}>
          {channel === 'dealer' && <aside className="agrilink-dealer-sidebar" aria-label="Kênh đại lý">
            {nav.manage.map((item) => <div key={item.path}>
              {item.path === '/agrilink/quan-ly/san-pham' && <div className="agrilink-dealer-group">Gian hàng</div>}
              {item.path === '/agrilink/quan-ly/ho-tro' && <div className="agrilink-dealer-group" aria-hidden="true" />}
              <NavLink to={item.path} data-tone={item.tone} end={item.path === '/agrilink/quan-ly'} className={({ isActive }) => `agrilink-dealer-link${isActive ? ' active' : ''}`}>
                {fluentColorIcon(item.colorIcon) ? <span className="agl-nav-icon" aria-hidden="true"><img src={fluentColorIcon(item.colorIcon)} alt="" /></span> : <i className={item.icon} aria-hidden="true" />}{item.label}
                {item.badgeKey === 'pendingOrders' && pending > 0 && <span className="badge bg-warning text-dark ms-auto">{pending}</span>}
                {item.badgeKey === 'messages' && messageUnread.chat > 0 && <span className="badge bg-primary ms-auto">{messageUnread.chat}</span>}
                {item.badgeKey === 'complaints' && messageUnread.other > 0 && <span className="badge bg-danger ms-auto">{messageUnread.other}</span>}
                {item.path === '/agrilink/quan-ly/nguon-hang' && leadCount > 0 && <span className="badge bg-primary ms-auto">{leadCount}</span>}
              </NavLink>
            </div>)}
            <button className="agrilink-dealer-link agrilink-dealer-app" data-tone="slate" type="button" onClick={() => openAppTab('/index', 'agripos-main')}><span className="agl-nav-icon" aria-hidden="true"><img src={fluentColorIcon('apps')} alt="" /></span>Về AgriPOS</button>
          </aside>}
          <main className={contentClass}><Outlet /></main>
        </div>
      </div>
      <nav className="agrilink-bottom-nav" aria-label="Điều hướng AgriLink">
        {primaryNav.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/agrilink' || item.path === '/agrilink/quan-ly'}
            className={({ isActive }) => `agrilink-bottom-link${isActive ? ' active' : ''}`}
          >
            <i className={item.icon} />
            <span>{item.label}</span>
            {badge(item) > 0 && <span className="badge bg-primary">{badge(item)}</span>}
          </NavLink>
        ))}
        {overflowNav.length > 0 && (
          <div className="agrilink-more">
            <button
              type="button"
              className="agrilink-bottom-link"
              onClick={() => setMoreOpen((x) => !x)}
              aria-expanded={moreOpen}
            >
              <i className="ti ti-dots" />
              <span>Thêm</span>
            </button>
            {moreOpen && (
              <div className="agrilink-more-menu">
                {overflowNav.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/agrilink/quan-ly'}
                    onClick={() => setMoreOpen(false)}
                    className="agrilink-nav-link"
                  >
                    <i className={item.icon} />
                    <span>{item.label}</span>
                    {badge(item) > 0 && <span className="badge bg-primary">{badge(item)}</span>}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    </div>
  );
}
