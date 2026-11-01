'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons.tsx';
import { LogoMark } from './logo.tsx';

export type NavLink = { href: string; label: string; icon: IconName; count?: number; unit?: string; tone?: 'warn' };
const STORE = 'fa-sidebar-collapsed';

// The sidebar: groups of links with their counts, collapsible to icons on a desktop and a drawer on a phone. The open
// drawer makes the rest of the page inert, so focus stays inside it; Escape, the scrim or a new page closes it.
export function Sidebar({ home, groups, foot }: { home: string; groups: { label: string; links: NavLink[] }[]; foot: ReactNode }) {
  const path = usePathname();
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORE) === '1');
    } catch {
      // Storage blocked, as in a private window: the sidebar opens wide.
    }
  }, []);
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(STORE, collapsed ? '0' : '1');
    } catch {
      // Storage blocked: the fold holds for this page only.
    }
  };

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const others = [...document.querySelectorAll<HTMLElement>('.shell > :not(.sidebar, .scrim)')];
    others.forEach((element) => (element.inert = true));
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      others.forEach((element) => (element.inert = false));
      document.removeEventListener('keydown', onKey);
      menu.current?.focus();
    };
  }, [open]);

  return (
    <>
      <header className="topbar">
        <Link href={home} className="wordmark">
          FreightAudit
        </Link>
        <button ref={menu} type="button" className="icon-button" aria-label="Open menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>
          <Icon name="menu" />
        </button>
      </header>
      <div className="scrim" data-open={open} onClick={() => setOpen(false)} />
      <aside ref={drawer} id={id} className="sidebar" data-collapsed={collapsed} data-open={open}>
        <div className="sidebar-head">
          <Link href={home} className="wordmark" title={collapsed ? 'FreightAudit' : undefined}>
            <span className="monogram">
              <LogoMark />
            </span>
            <span className="label">FreightAudit</span>
          </Link>
          <button type="button" className="icon-button collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={toggle}>
            <Icon name={collapsed ? 'expand' : 'collapse'} />
          </button>
          <button type="button" className="icon-button close" aria-label="Close menu" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <nav className="nav" aria-label="Main">
          {groups.map((group) => (
            <div key={group.label} role="group" aria-labelledby={`${id}-${group.label}`}>
              <p className="nav-group" id={`${id}-${group.label}`}>
                {group.label}
              </p>
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  title={collapsed ? link.label : undefined}
                  aria-current={path.startsWith(link.href) ? 'page' : undefined}
                  aria-label={link.count ? `${link.label}, ${link.count} ${link.unit}${link.count === 1 ? '' : 's'}` : undefined}
                >
                  <Icon name={link.icon} />
                  <span className="label">{link.label}</span>
                  {link.count !== undefined && link.count > 0 && <span className={`count${link.tone ? ` ${link.tone}` : ''}`}>{link.count}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">{foot}</div>
      </aside>
    </>
  );
}
