'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { IconBell, IconClose, IconGear, IconGrid, IconLogout, IconMenu, IconPlane } from './icons';

/** Both languages visible, the current one highlighted – a single "RU"/"EN" button was ambiguous
 *  (does it show the current language or the one it switches to?). */
export function LangSwitch() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label="Language / Язык">
      {(['ru', 'en'] as const).map((l) => (
        <button key={l} className={locale === l ? 'on' : ''} aria-pressed={locale === l} onClick={() => setLocale(l)}
          title={l === 'ru' ? 'Русский' : 'English'} lang={l}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

type Me = { email: string; name?: string | null };

const initials = (me: Me | null) => {
  if (!me) return '';
  const words = (me.name || me.email.split('@')[0]).split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).toUpperCase();
};

/** Shared count of trackers for the sidebar badge (refreshed by pages that load the list). */
let trackerCount: number | null = null;
const listeners = new Set<(n: number) => void>();
export function setTrackerCount(n: number) { trackerCount = n; listeners.forEach((l) => l(n)); }

/** The profile is fetched once per session, not on every navigation. */
let mePromise: Promise<Me> | null = null;
const getMe = () => (mePromise ??= api<Me>('/auth/me').catch((e) => { mePromise = null; throw e; }));

export function Brand() {
  const { t } = useI18n();
  return (
    <Link href="/dashboard" className="brand">
      <span className="brand-mark"><IconPlane size={22} /></span>
      <span className="brand-text"><b>{t.brand}</b><small>{t.brandSub}</small></span>
    </Link>
  );
}

export default function AppShell({ children, crumb }: { children: ReactNode; crumb?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [count, setCount] = useState<number | null>(trackerCount);
  const [open, setOpen] = useState(false);

  useEffect(() => { getMe().then(setMe).catch(() => {}); }, []);
  useEffect(() => {
    listeners.add(setCount);
    if (trackerCount == null) api<any[]>('/trackers').then((l) => setTrackerCount(l.length)).catch(() => {});
    return () => { listeners.delete(setCount); };
  }, []);
  useEffect(() => { setOpen(false); }, [path]);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    mePromise = null; trackerCount = null;
    router.push('/login');
  };

  const nav = [
    { href: '/dashboard', label: t.overview, icon: <IconGrid />, active: path === '/dashboard' },
    { href: '/trackers', label: t.trackersNav, icon: <IconPlane />, active: path?.startsWith('/trackers'), badge: count },
    { href: '/notifications', label: t.notifications, icon: <IconBell />, active: path === '/notifications' },
    { href: '/settings', label: t.settings, icon: <IconGear />, active: path === '/settings' },
  ];

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <Brand />
          <button className="icon-btn only-mobile" onClick={() => setOpen(false)} aria-label={t.close}><IconClose /></button>
        </div>
        <div className="nav-label">{t.workspace}</div>
        <nav className="side-nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={n.active ? 'on' : ''} aria-current={n.active ? 'page' : undefined}>
              {n.icon}<span>{n.label}</span>
              {n.badge != null && <em className="badge">{n.badge}</em>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="promo">
            <span className="promo-icon"><IconPlane size={20} /></span>
            <b>{t.dreamTitle}</b>
            <p>{t.dreamText}</p>
          </div>
          <div className="user-card">
            <span className="avatar">{initials(me)}</span>
            <span className="user-text"><b>{me?.name || t.account}</b><small>{me?.email ?? ''}</small></span>
            <button className="icon-btn" onClick={logout} title={t.logout} aria-label={t.logout}><IconLogout size={18} /></button>
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn only-mobile" onClick={() => setOpen(true)} aria-label={t.menu}><IconMenu /></button>
          <div className="crumbs">
            <span>{t.workspace}</span><i>/</i><b>{crumb ?? t.dashboard}</b>
          </div>
          <div className="top-actions">
            <span className="service-ok hide-sm"><i />{t.serviceActive}</span>
            <Link href="/notifications" className="icon-btn bordered" aria-label={t.notifications}><IconBell size={19} /></Link>
            <LangSwitch />
            <Link href="/settings" className="avatar sm" title={me?.email}>{initials(me)}</Link>
          </div>
        </header>
        <main className="page">{children}</main>
        <footer className="page-foot">{t.disclaimer}</footer>
      </div>
    </div>
  );
}

/** Eyebrow + title (+ count) + subtitle + optional action – the page header of the design. */
export function PageHeader({ title, count, sub, action }: { title: string; count?: number; sub?: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">LLB • Flight price tracker</div>
        <h1>{title}{count != null && <span className="count"> ({count})</span>}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
