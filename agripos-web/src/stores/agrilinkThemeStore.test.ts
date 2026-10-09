import { beforeEach, describe, expect, it } from 'vitest';
import { useAgrilinkTheme } from './agrilinkThemeStore';

describe('agrilink theme', () => {
  beforeEach(() => useAgrilinkTheme.setState({ theme: 'light' }));

  it('starts light and toggles between light and dark', () => {
    expect(useAgrilinkTheme.getState().theme).toBe('light');
    useAgrilinkTheme.getState().toggle();
    expect(useAgrilinkTheme.getState().theme).toBe('dark');
    useAgrilinkTheme.getState().toggle();
    expect(useAgrilinkTheme.getState().theme).toBe('light');
  });

  it('remembers the choice in localStorage', () => {
    useAgrilinkTheme.getState().setTheme('dark');
    expect(localStorage.getItem('agrilink_theme_v1')).toContain('"theme":"dark"');
  });
});
