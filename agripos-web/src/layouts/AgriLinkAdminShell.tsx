import { Link, NavLink, Outlet } from 'react-router-dom';
import { ToastHost } from '../components/ui';
import { initials } from '../utils/initials';
import { useAuthStore } from '../stores/authStore';
import BrandMark from '../components/brand/BrandMark';
import './AgriLinkShell.css';
import { useAgrilinkThemeEffect } from './useAgrilinkThemeEffect';
import './agrilink-gray.css';
import './agrilink-dark.css';
import './agrilink-motion.css';

export default function AgriLinkAdminShell() {
  const user = useAuthStore((state) => state.user);
  const theme = useAgrilinkThemeEffect();
  return <div className="agrilink-shell preview-scope" data-agl-theme={theme}>
    <ToastHost />
    <div className="agrilink-main">
      <header className="agrilink-header bg-white border-bottom px-4 py-3 d-flex align-items-center gap-3">
        <Link to="/agrilink" className="agrilink-logo text-decoration-none">
          <BrandMark className="agrilink-logo-mark" />
          <span>Agri<span className="agrilink-logo-accent">Link</span></span>
        </Link>
        <span className="badge bg-primary">Quản trị nền tảng</span>
        <nav className="d-flex gap-1 ms-3" aria-label="Quản trị">
          <NavLink to="/agrilink/quan-tri/xac-minh" className={({ isActive }) => `btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline-secondary'}`}>
            Duyệt xác minh
          </NavLink>
          <NavLink to="/agrilink/quan-tri/khieu-nai" className={({ isActive }) => `btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline-secondary'}`}>
            Khiếu nại & hỗ trợ
          </NavLink>
        </nav>
        <span className="ms-auto badge bg-secondary">{initials(user?.fullName || 'Quản trị')}</span>
      </header>
      <main className="agrilink-content">
        <Outlet />
      </main>
    </div>
  </div>;
}
