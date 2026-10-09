import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AgrilinkTheme = 'light' | 'dark';

type ThemeState = {
  theme: AgrilinkTheme;
  toggle: () => void;
  setTheme: (theme: AgrilinkTheme) => void;
};

/** Chế độ Sáng/Tối của AgriLink (AgriPOS luôn sáng); nhớ theo trình duyệt. */
export const useAgrilinkTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'light',
      toggle: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'agrilink_theme_v1' },
  ),
);
