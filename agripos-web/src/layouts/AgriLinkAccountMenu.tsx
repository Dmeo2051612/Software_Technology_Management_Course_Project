import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { initials } from '../utils/initials';
import { openAppTab } from '../utils/openAppTab';
import { useAgrilinkTheme } from '../stores/agrilinkThemeStore';

/** Nút tài khoản + menu thả xuống (Hồ sơ, Hỗ trợ, Về AgriPOS, Đăng xuất). */
export default function AgriLinkAccountMenu({ channel }: { channel: 'buyer' | 'dealer' }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const dark = useAgrilinkTheme((s) => s.theme === 'dark');
  const toggleTheme = useAgrilinkTheme((s) => s.toggle);
  return (
    <div className="dropdown">
      <button
        className="agrilink-avatar-button dropdown-toggle"
        data-bs-toggle="dropdown"
        type="button"
        aria-label={`Tài khoản ${user?.fullName || ''}`}
      >
        <span className="agrilink-avatar-initials">{initials(user?.fullName || 'Tài khoản')}</span>
        <span className="agrilink-avatar-name">{user?.fullName || 'Tài khoản'}</span>
      </button>
      <ul className="dropdown-menu dropdown-menu-end">
        <li>
          {user?.role === 'farmer' ? (
            <NavLink className="dropdown-item" to="/farmer/profile">
              Hồ sơ
            </NavLink>
          ) : (
            <button type="button" className="dropdown-item" onClick={() => openAppTab('/profile', 'agripos-main')}>
              Hồ sơ
            </button>
          )}
        </li>
        <li>
          <NavLink className="dropdown-item" to={channel === 'dealer' ? '/agrilink/quan-ly/ho-tro' : '/agrilink/ho-tro'}>
            Trung tâm hỗ trợ
          </NavLink>
        </li>
        {user?.role !== 'farmer' && (
          <li>
            <button type="button" className="dropdown-item" onClick={() => openAppTab('/index', 'agripos-main')}>
              Về AgriPOS
            </button>
          </li>
        )}
        <li>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={dark}
            className="dropdown-item agl-theme-item"
            onClick={toggleTheme}
          >
            <span>
              <i className={`ti ${dark ? 'ti-moon-filled' : 'ti-moon'} me-2`} aria-hidden="true" />
              Chế độ tối
            </span>
            <span className={`agl-switch${dark ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
        </li>
        <li>
          <button type="button" className="dropdown-item" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </li>
      </ul>
    </div>
  );
}
