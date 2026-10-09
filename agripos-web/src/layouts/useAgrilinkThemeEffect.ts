import { useEffect } from 'react';
import { useAgrilinkTheme, type AgrilinkTheme } from '../stores/agrilinkThemeStore';

/**
 * Áp chế độ Sáng/Tối khi đang ở AgriLink: bật data-bs-theme cho Bootstrap (hộp
 * thoại, menu thả xuống nằm ngoài khung) và gỡ khi rời AgriLink sang AgriPOS.
 */
export function useAgrilinkThemeEffect(): AgrilinkTheme {
  const theme = useAgrilinkTheme((s) => s.theme);
  useEffect(() => {
    if (theme !== 'dark') return;
    const root = document.documentElement;
    root.setAttribute('data-bs-theme', 'dark');
    document.body.classList.add('agl-dark');
    return () => {
      root.removeAttribute('data-bs-theme');
      document.body.classList.remove('agl-dark');
    };
  }, [theme]);
  return theme;
}
