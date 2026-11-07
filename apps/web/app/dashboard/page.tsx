'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { RunChip, Trend } from '@/components/Trend';
import { api, dateRange, fmtDateTime, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function Dashboard() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api('/trackers').then(setItems).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  // refresh while a search is running (UI never blocks on search)
  useEffect(() => {
    if (!items?.some((i) => i.lastRun && ['QUEUED', 'RUNNING'].includes(i.lastRun.status))) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [items, load]);

  const act = async (id: string, action: 'pause' | 'resume' | 'delete') => {
    if (action === 'delete' && !confirm(t.confirmDelete)) return;
    await api(`/trackers/${id}${action === 'delete' ? '' : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST' });
    load();
  };

  return (
    <AppShell>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{t.dashboard}</h1>
        <span className="spacer" />
        <Link className="btn primary" href="/trackers/new">{t.addTracker}</Link>
      </div>
      {error && <div className="error">{error}</div>}
      {items && items.length === 0 && <div className="card muted">{t.noTrackers}</div>}
      {items && items.length > 0 && (
        <div className="card table-wrap" style={{ padding: 8 }}>
          <table>
            <thead>
              <tr>
                <th>{t.direction}</th><th>{t.dates}</th><th className="num">{t.minPrice}</th><th>{t.trend}</th>
                <th className="hide-sm">{t.lastCheck}</th><th className="hide-sm">{t.status}</th><th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const running = i.lastRun && ['QUEUED', 'RUNNING'].includes(i.lastRun.status);
                return (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/trackers/${i.id}`}><b>{i.originAirport} → {i.country.flag} {i.country.name[locale]}</b></Link>
                      {i.name && <div className="small muted">{i.name}</div>}
                    </td>
                    <td className="small">{dateRange(i.departureDate, i.returnDate, locale)}</td>
                    <td className="num">
                      <b>{money(i.minPrice, i.currency, locale)}</b>
                      {i.priceStatus === 'INDICATIVE' && <div className="small muted" title={t.indicativeHint}>~ {t.indicative}</div>}
                    </td>
                    <td><Trend pct={i.priceChangePct} status={i.trendStatus} /></td>
                    <td className="small muted hide-sm">
                      {running ? t.searching : i.lastRun ? fmtDateTime(i.lastRun.completedAt ?? i.lastRun.startedAt, locale) : t.never}
                      {i.lastRun?.status === 'FAILED' && <div><RunChip status="FAILED" /></div>}
                    </td>
                    <td className="hide-sm"><span className={`chip ${i.status === 'ACTIVE' ? 'ok' : ''}`}>{i.status === 'ACTIVE' ? t.active : t.paused}</span></td>
                    <td className="small">
                      <div className="row actions" style={{ gap: 10 }}>
                        <Link href={`/trackers/${i.id}`}>{t.view}</Link>
                        <Link href={`/trackers/${i.id}/edit`}>{t.edit}</Link>
                        <button className="link-btn" onClick={() => act(i.id, i.status === 'ACTIVE' ? 'pause' : 'resume')}>{i.status === 'ACTIVE' ? t.pause : t.resume}</button>
                        <button className="link-btn danger" onClick={() => act(i.id, 'delete')}>{t.delete}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
