'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppShell, { PageHeader } from '@/components/AppShell';
import { IconBell } from '@/components/icons';
import { api, fmtDateTime } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function Notifications() {
  const { t, locale } = useI18n();
  const [logs, setLogs] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/notifications/logs').then(setLogs).catch((e) => setError(e.message)); }, []);

  return (
    <AppShell crumb={t.notifications}>
      <PageHeader title={t.notifications} sub={t.notificationsSub}
        action={<Link className="btn" href="/settings">{t.notificationSettings}</Link>} />
      {error && <div className="error" role="alert">{error}</div>}
      <section className="card table-card">
        <div className="table-head"><div><h2>{t.recentNotifications}</h2></div></div>
        {logs && logs.length === 0 && (
          <div className="empty-state"><span className="stat-icon blue"><IconBell /></span><p className="muted">{t.noNotifications}</p></div>
        )}
        {logs && logs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.when}</th><th>{t.kind}</th><th>{t.channel}</th><th>{t.status}</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap">{fmtDateTime(l.sentAt, locale)}</td>
                    <td>{(t as any)[`KIND_${l.kind}`] ?? l.kind}</td>
                    <td>{l.channel === 'EMAIL' ? t.emailCh : t.whatsappCh}</td>
                    <td>
                      <span className={`pill ${l.status === 'SENT' ? 'ok' : l.status === 'FAILED' ? 'bad' : 'neutral'}`}>{(t as any)[`NS_${l.status}`] ?? l.status}</span>
                      {l.error && <small className="bad">{l.error}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!logs && !error && <div className="skeleton" />}
      </section>
    </AppShell>
  );
}
