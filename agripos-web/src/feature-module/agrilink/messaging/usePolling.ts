import { useEffect, useRef } from 'react';

/**
 * Gọi `task` định kỳ (không cần máy chủ realtime). Tạm dừng khi tab bị ẩn và
 * chạy ngay khi người dùng quay lại tab.
 */
export function usePolling(task: () => void | Promise<void>, intervalMs: number, enabled = true): void {
  const saved = useRef(task);
  useEffect(() => {
    saved.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const tick = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        await saved.current();
      } catch {
        // Lỗi mạng tạm thời: bỏ qua, lần sau thử lại.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void tick(), intervalMs);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled]);
}
