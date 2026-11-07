'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { Flag } from '@/components/icons';
import { LegStops, LegTimes } from '@/components/Itinerary';
import PriceChart from '@/components/PriceChart';
import { RunChip, Trend } from '@/components/Trend';
import { api, dateRange, fmtDateTime, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function TrackerDetails({ params }: { params: { id: string } }) {
  const { t, locale } = useI18n();
  const id = params.id;
  const [tracker, setTracker] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const [range, setRange] = useState<'7' | '30' | 'all'>('30');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [tr, r, tn] = await Promise.all([api(`/trackers/${id}`), api(`/trackers/${id}/results`), api(`/trackers/${id}/trends`)]);
      setTracker(tr); setResults(r); setTrends(tn);
    } catch (e: any) { setError(e.message); }
  }, [id]);
  const loadHistory = useCallback(() => api(`/trackers/${id}/history?range=${range}`).then(setHistory).catch(() => {}), [id, range]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => {
    if (!results?.inProgress) return;
    const h = setInterval(() => { load(); loadHistory(); }, 4000);
    return () => clearInterval(h);
  }, [results?.inProgress, load, loadHistory]);

  const searchNow = async () => {
    setMsg(''); setError('');
    try { await api(`/trackers/${id}/search`, { method: 'POST' }); setMsg(t.searchQueued); setTimeout(load, 1500); }
    catch (e: any) { setError(e.message); }
  };

  const openFlight = (o: any) => {
    if (confirm(t.leaveConfirm(fmtDateTime(o.observedAt, locale)))) window.open(o.bookingUrl, '_blank', 'noopener');
  };

  if (error && !tracker) return <AppShell crumb={t.trackersNav}><div className="error">{error}</div></AppShell>;
  if (!tracker) return <AppShell crumb={t.trackersNav}><div className="card skeleton" /></AppShell>;

  const a = trends?.analysis;
  const cur = tracker.currency;
  const runStatus = results?.run?.status;
  const pctStr = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);

  return (
    <AppShell crumb={`${tracker.originAirport} → ${tracker.country.name[locale]}`}>
      <div className="page-head" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">LLB • {t.trackersNav}</div>
          <div className="row" style={{ gap: 14 }}>
            <Flag code={tracker.destinationCountry} />
            <h1 style={{ margin: 0 }}>{tracker.originAirport} → {tracker.country.name[locale]}</h1>
            <span className={`pill ${tracker.status === 'ACTIVE' ? 'ok' : 'paused'}`}><i />{tracker.status === 'ACTIVE' ? t.active : t.paused}</span>
          </div>
        </div>
        <div className="row">
          <Link className="btn" href={`/trackers/${id}/edit`}>{t.edit}</Link>
          <button className="btn primary" onClick={searchNow} disabled={tracker.status !== 'ACTIVE' || results?.inProgress}>
            {results?.inProgress ? t.searching : t.searchNow}
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {tracker.name && <><b>{tracker.name}</b> · </>}
        {dateRange(tracker.departureDate, tracker.returnDate, locale)} · {(t as any)[tracker.cabinClass]} · {tracker.adults} 👤 ·{' '}
        {tracker.maxStops === 0 ? t.direct : tracker.maxStops === 1 ? t.upTo1 : t.upTo2}
        {tracker.lastSuccessfulCheckAt && <> · {t.lastCheck}: {fmtDateTime(tracker.lastSuccessfulCheckAt, locale)}</>}
      </p>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}

      {runStatus === 'FAILED' && <div className="notice">⚠️ {t.failedRun}</div>}

      {a && a.currentMinPrice != null && (
        <div className="card">
          <div className="stats">
            <div className="stat"><div className="label">{t.current}</div><div className="value">{money(a.currentMinPrice, cur, locale)}</div>
              {a.currentPriceStatus === 'INDICATIVE' && <div className="small" style={{ color: 'var(--warn)' }} title={t.indicativeHint}>~ {t.indicative}</div>}</div>
            <div className="stat"><div className="label">{t.previous}</div><div className="value">{money(a.previousPrice, cur, locale)}</div></div>
            <div className="stat"><div className="label">{t.change}</div><div className="value"><Trend pct={a.priceChangePct} status={a.status} /></div>
              <div className="small muted">{(t as any)[a.status]}</div></div>
            <div className="stat"><div className="label">{t.min7}</div><div className="value">{money(a.min7d, cur, locale)}</div></div>
            <div className="stat"><div className="label">{t.min30}</div><div className="value">{money(a.min30d, cur, locale)}</div></div>
            <div className="stat"><div className="label">{t.histMin}</div><div className="value">{money(a.historicalMin, cur, locale)}</div></div>
          </div>
          <div className="row small" style={{ marginTop: 10 }}>
            {a.isNewHistoricalLow && <span className="chip ok">{t.newLow}</span>}
            {a.targetReached && <span className="chip ok">{t.target}</span>}
          </div>
          {a.cheapestRouteChanged && <p className="small muted">ℹ️ {t.routeChanged(a.previousBestDestination, a.bestDestination)}</p>}
          {a.cheapestRouteChanged && a.sameRoute?.changePct != null && <p className="small muted">{t.sameRoute(pctStr(a.sameRoute.changePct))}</p>}
        </div>
      )}

      <h2>{t.cheapest}</h2>
      <div className="card table-wrap" style={{ padding: 8 }}>
        {!results?.run && <p className="muted" style={{ padding: 8 }}>{t.notYet}</p>}
        {results?.run && results.offers.length === 0 && runStatus !== 'FAILED' && <p className="muted" style={{ padding: 8 }}>{t.noOffers}</p>}
        {results?.offers?.length > 0 && (
          <table>
            <thead>
              <tr><th>{t.destination}</th><th>{t.dates}</th><th className="hide-sm">{t.airline}</th><th>{t.stops}</th><th className="num">{t.price}</th><th className="hide-sm">{t.checkedAt}</th><th /></tr>
            </thead>
            <tbody>
              {results.offers.slice(0, 15).map((o: any) => (
                <tr key={o.id}>
                  <td><b>{o.destinationCity?.[locale] ?? o.destinationAirport}</b> <span className="muted small">{o.destinationAirport}</span></td>
                  <td className="small">{o.segments?.outbound?.length ? <LegTimes segments={o.segments} outboundMin={o.outboundDurationMin} inboundMin={o.inboundDurationMin} /> : dateRange(o.departureDate, o.returnDate, locale)}</td>
                  <td className="small hide-sm">{o.airline ?? '—'}</td>
                  <td className="small">{o.segments?.outbound?.length ? <LegStops segments={o.segments} places={results.places} outboundStops={o.outboundStops} inboundStops={o.inboundStops} /> : <>{o.outboundStops} {t.out} / {o.inboundStops} {t.back}</>}</td>
                  <td className="num">
                    <b>{money(o.price, o.currency, locale)}</b>
                    {o.provider === 'mock'
                      ? <div className="small" style={{ color: 'var(--warn)' }} title={t.demoHint}>{t.demo}</div>
                      : o.priceStatus === 'INDICATIVE'
                      ? <div className="small" style={{ color: 'var(--warn)' }} title={t.indicativeHint}>~ {t.indicative}</div>
                      : <div className="small muted">{t.live}</div>}
                    {o.baggageIncluded === false && o.baggagePrice != null && <div className="small muted">{t.baggage}: {t.bagExtra(money(o.baggagePrice, o.currency, locale))}</div>}
                    {o.baggageIncluded === true && <div className="small muted">{t.baggage}: {t.bagIncluded}</div>}
                  </td>
                  <td className="small muted hide-sm">{fmtDateTime(o.observedAt, locale)}</td>
                  <td>{o.bookingUrl && <button className="btn sm" onClick={() => openFlight(o)}>{t.viewFlight}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="row" style={{ marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>{t.priceHistory}</h2>
        <span className="spacer" />
        <div className="tabs">
          {(['7', '30', 'all'] as const).map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r === '7' ? t.d7 : r === '30' ? t.d30 : t.all}</button>
          ))}
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <PriceChart points={history?.points ?? []} currency={cur} locale={locale} />
      </div>

      <h2>{t.dailyHistory}</h2>
      <div className="card table-wrap" style={{ padding: 8 }}>
        <table>
          <thead><tr><th>{t.checkedAt}</th><th>{t.trigger}</th><th>{t.status}</th><th className="num">{t.minPrice}</th><th>{t.change}</th><th className="hide-sm num">{t.combinationsChecked}</th></tr></thead>
          <tbody>
            {history?.runs?.map((r: any) => (
              <tr key={r.id}>
                <td className="small">{fmtDateTime(r.completedAt ?? r.startedAt, locale)}</td>
                <td className="small muted">{(t as any)[r.trigger]}</td>
                <td><RunChip status={r.status} /></td>
                <td className="num">{money(r.minPrice, cur, locale)}</td>
                <td className="small">{r.status === 'FAILED' ? '—' : pctStr(r.priceChangePct)}</td>
                <td className="num small muted hide-sm">{r.combinationsChecked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
