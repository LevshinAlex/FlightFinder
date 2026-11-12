'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Country, fmtDate, fmtDateTime, getCountries, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Flag, IconDots, IconClock, IconSearch } from './icons';
import { TrendPill } from './Trend';

type Tracker = any;

/** ACTIVE / PAUSED, plus the derived "dates passed" state – an active tracker with nothing left to search. */
export function StatusPill({ tr }: { tr: Tracker }) {
  const { t } = useI18n();
  if (tr.expired) return <span className="pill" title={t.expiredHint}><i />{t.expired}</span>;
  const active = tr.status === 'ACTIVE';
  return <span className={`pill ${active ? 'ok' : 'paused'}`}><i />{active ? t.active : t.paused}</span>;
}

function RowMenu({ tr, onAction }: { tr: Tracker; onAction: (a: 'pause' | 'resume' | 'delete') => void }) {
  const { t } = useI18n();
  // One state instead of two booleans: every way of closing returns to 'closed', so the menu can
  // never reopen with "Confirm delete" already armed (one click from deleting).
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirmDelete'>('closed');
  const open = menu !== 'closed';
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const armedAt = useRef(0);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu('closed'); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu('closed'); trigger.current?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  // keyboard: opening moves focus to the first action (Tab walks the rest, Escape returns to the button)
  useEffect(() => { if (menu === 'open') list.current?.querySelector<HTMLElement>('a, button')?.focus(); }, [menu]);
  const choose = (a: 'pause' | 'resume' | 'delete') => { setMenu('closed'); onAction(a); };
  const active = tr.status === 'ACTIVE';
  const listId = `actions-${tr.id}`;
  return (
    <div className="menu-wrap" ref={ref}>
      {/* a disclosure, not an ARIA menu: plain buttons/links that Tab reaches – no arrow-key contract to break */}
      <button ref={trigger} className="icon-btn bordered sm" aria-expanded={open} aria-controls={listId} aria-label={t.more}
        onClick={() => setMenu(open ? 'closed' : 'open')}>
        <IconDots size={18} />
      </button>
      {open && (
        <div className="menu" id={listId} ref={list}>
          <Link href={`/trackers/${tr.id}/edit`}>{t.edit}</Link>
          <button onClick={() => choose(active ? 'pause' : 'resume')}>{active ? t.pause : t.resume}</button>
          {/* the same button arms and then confirms: focus stays on it, and a held/repeated Enter can't confirm at once */}
          <button className={menu === 'confirmDelete' ? 'danger strong' : 'danger'} onClick={() => {
            if (menu !== 'confirmDelete') { armedAt.current = Date.now(); setMenu('confirmDelete'); }
            else if (Date.now() - armedAt.current > 400) choose('delete');
          }}>{menu === 'confirmDelete' ? t.confirmDeleteShort : t.delete}</button>
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
  const [actionError, setActionError] = useState('');
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
    setActionError('');
    try {
      await api(`/trackers/${id}${action === 'delete' ? '' : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST' });
    } catch (e: any) {
      setActionError(e.message); // the row keeps showing the real (unchanged) state after the reload
    }
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
            <input type="search" placeholder={`${t.searchDirection}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t.searchDirection} />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} aria-label={t.status}>
            <option value="ALL">{t.allStatuses}</option>
            <option value="ACTIVE">{t.active}</option>
            <option value="PAUSED">{t.paused}</option>
          </select>
        </div>
      </div>

      {actionError && <div className="error" role="alert">{actionError}</div>}
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
              const running = i.inProgress; // decided by the API (ignores runs whose worker died)
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
                    <StatusPill tr={i} />
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
