'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export function LangSwitch() {
  const { locale, setLocale } = useI18n();
  return (
    <button className="link-btn" onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')} aria-label="Language">
      {locale === 'ru' ? 'EN' : 'RU'}
    </button>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const [me, setMe] = useState<{ email: string } | null>(null);
  useEffect(() => { api('/auth/me').then(setMe).catch(() => {}); }, []);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); router.push('/login'); };
  return (
    <>
      <header className="top">
        <div className="container">
          <Link href="/dashboard" className="brand">✈️ {t.appName}</Link>
          <nav>
            <Link href="/dashboard">{t.dashboard}</Link>
            <Link href="/settings">{t.settings}</Link>
            <LangSwitch />
            {me && <span className="muted small hide-sm">{me.email}</span>}
            <button className="link-btn" onClick={logout}>{t.logout}</button>
          </nav>
        </div>
      </header>
      <main className="container">{children}</main>
      <footer className="container">{t.disclaimer}</footer>
    </>
  );
}
