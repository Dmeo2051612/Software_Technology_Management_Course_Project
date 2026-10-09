import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { openAppTab } from '../utils/openAppTab';
import type { AppMenuSection } from './agrilinkNav';

/** Nút lưới 9 chấm mở bảng "Menu" liệt kê mọi chức năng, như Facebook. */
export default function AgriLinkAppMenu({ sections }: { sections: AppMenuSection[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  // Thứ tự của mục trên toàn bảng — các mục hiện lần lượt từ trên xuống (mockup 53 · M8).
  const order = new Map(sections.flatMap((section) => section.items).map((item, i) => [item, i]));
  const stagger = (item: AppMenuSection['items'][number]) => ({ '--i': Math.min(order.get(item) ?? 0, 10) }) as CSSProperties;
  return (
    <div className="alh-menu" ref={rootRef}>
      <button
        type="button"
        className={`alh-circle${open ? ' is-open' : ''}`}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
      >
        <i className="ti ti-grid-dots" aria-hidden="true" />
        {!open && <span className="alh-tip" aria-hidden="true">Menu</span>}
      </button>
      {open && (
        <div className="alh-menu-panel" role="dialog" aria-label="Menu AgriLink">
          <h2>Menu</h2>
          {sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.items.map((item) => {
                const body = (
                  <>
                    <span className="alh-menu-icon">
                      <i className={item.icon} aria-hidden="true" />
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.hint}</small>
                    </span>
                  </>
                );
                return item.path ? (
                  <NavLink key={item.label} to={item.path} end className="alh-menu-item" style={stagger(item)} onClick={close}>
                    {body}
                  </NavLink>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    className="alh-menu-item"
                    style={stagger(item)}
                    onClick={() => {
                      close();
                      openAppTab('/index', 'agripos-main');
                    }}
                  >
                    {body}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
