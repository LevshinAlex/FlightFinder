'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Country, fmtDate, fmtDateTime, getCountries, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Flag, IconDots, IconClock, IconSearch } from './icons';
import { TrendPill } from './Trend';

type Tracker = any;

function RowMenu({ tr, onAction }: { tr: Tracker; onAction: (a: 'pause' | 'resume' | 'delete') => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setConfirming(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setConfirming(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const active = tr.status === 'ACTIVE';
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn bordered sm" aria-haspopup="menu" aria-expanded={open} aria-label={t.more} onClick={() => setOpen((o) => !o)}>
        <IconDots size={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <Link role="menuitem" href={`/trackers/${tr.id}/edit`}>{t.edit}</Link>
          <button role="menuitem" onClick={() => { setOpen(false); onAction(active ? 'pause' : 'resume'); }}>{active ? t.pause : t.resume}</button>
          {confirming
            ? <button role="menuitem" className="danger strong" onClick={() => { setOpen(false); onAction('delete'); }}>{t.confirmDeleteShort}</button>
            : <button role="menuitem" className="danger" onClick={() => setConfirming(true)}>{t.delete}</button>}
        </div>
      )}
    </div>
  );
}

export default function TrackerTable({ items, reload }: { items: Tracker[]; reload: () => void }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');
  const [countries, setCountries] = useState<Country[]>([]);
  useEffect(() => { getCountries().then(setCountries).catch(() => {}); }, []);

  const subtitle = (tr: Tracker) => {
    if (tr.name) return tr.name;
    if (!tr.destinationAirports?.length) return t.allAirportsShort;
    const c = countries.find((x) => x.code === tr.destinationCountry);
    const cities = tr.destinationAirports.map((a: string) => c?.airports.find((x) => x.iata === a)?.city[locale] ?? a);
    return [...new Set(cities)].join(', ');
  };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (status === 'ALL' || i.status === status) && (!s ||
      [i.name, i.originAirport, i.destinationCountry, i.country.name.ru, i.country.name.en, ...(i.destinationAirports ?? [])]
        .some((v) => v && String(v).toLowerCase().includes(s))));
  }, [items, q, status]);

  const act = async (id: string, action: 'pause' | 'resume' | 'delete') => {
    await api(`/trackers/${id}${action === 'delete' ? '' : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST' });
    reload();
  };

  return (
    <section className="card table-card">
      <div className="table-head">
        <div>
          <h2>{t.tracked}</h2>
          <p className="muted small">{t.trackedSub}</p>
        </div>
        <div className="filters">
          <label className="search">
            <IconSearch size={17} />
            <input type="search" placeholder={t.searchDirection} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t.searchDirection} />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} aria-label={t.status}>
            <option value="ALL">{t.allStatuses}</option>
            <option value="ACTIVE">{t.active}</option>
            <option value="PAUSED">{t.paused}</option>
          </select>
        </div>
      </div>

      <div className="table-wrap">
        <table className="trackers">
          <thead>
            <tr>
              <th>{t.direction}</th><th>{t.tripDates}</th><th>{t.minPrice}</th><th>{t.trend}</th>
              <th className="hide-md">{t.check}</th><th className="hide-sm">{t.status}</th><th className="right">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const running = i.lastRun && ['QUEUED', 'RUNNING'].includes(i.lastRun.status);
              const failed = i.lastRun?.status === 'FAILED';
              return (
                <tr key={i.id}>
                  <td>
                    <Link href={`/trackers/${i.id}`} className="dest">
                      <Flag code={i.destinationCountry} />
                      <span>
                        <b>{i.originAirport} <span className="arrow">→</span> {i.country.name[locale]}</b>
                        <small>{subtitle(i)}</small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <b className="nowrap">{fmtDate(i.departureDate, locale)} – {fmtDate(i.returnDate, locale)}</b>
                    <small className="muted">{i.departureDate.slice(0, 4)} · {t.roundTrip}</small>
                  </td>
                  <td>
                    <b className="price">{money(i.minPrice, i.currency, locale)}</b>
                    <small className="muted" title={i.priceStatus === 'INDICATIVE' ? t.indicativeHint : undefined}>
                      {i.minPrice == null ? '' : i.priceStatus === 'INDICATIVE' ? `~ ${t.indicative}` : t.perPax(i.adults)}
                    </small>
                  </td>
                  <td><TrendPill pct={i.priceChangePct} status={i.trendStatus} /></td>
                  <td className="hide-md">
                    <b className="nowrap">{running ? t.searching : i.lastRun ? fmtDateTime(i.lastRun.completedAt ?? i.lastRun.startedAt, locale) : t.never}</b>
                    <small className={failed ? 'bad' : 'muted'}>{failed ? t.checkFailed : t.lastSearch}</small>
                  </td>
                  <td className="hide-sm">
                    <span className={`pill ${i.status === 'ACTIVE' ? 'ok' : 'paused'}`}><i />{i.status === 'ACTIVE' ? t.active : t.paused}</span>
                  </td>
                  <td className="right">
                    <div className="row-actions">
                      <Link href={`/trackers/${i.id}`} className="open-link">{t.view}</Link>
                      <RowMenu tr={i} onAction={(a) => act(i.id, a)} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7} className="empty">{items.length ? t.noMatches : t.noTrackers}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span><IconClock size={15} /> {t.lastResults}</span>
        <span>{t.directionsCount(rows.length)}</span>
      </div>
    </section>
  );
}
