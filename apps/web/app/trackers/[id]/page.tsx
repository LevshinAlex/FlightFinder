'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { Flag } from '@/components/icons';
import { LegStops, LegTimes } from '@/components/Itinerary';
import PriceChart from '@/components/PriceChart';
import { StatusPill } from '@/components/TrackerTable';
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
  const [error, setError] = useState(''); // last action (search now)
  const [loadError, setLoadError] = useState(''); // last refresh – cleared by the next successful one
  const [requesting, setRequesting] = useState(false);
  const [tick, setTick] = useState(0); // bumped while a search is in progress → refresh everything

  const load = useCallback(async () => {
    try {
      const [tr, r, tn] = await Promise.all([api(`/trackers/${id}`), api(`/trackers/${id}/results`), api(`/trackers/${id}/trends`)]);
      setTracker(tr); setResults(r); setTrends(tn); setLoadError('');
    } catch (e: any) { setLoadError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => {
    let current = true; // a slow answer for the previously selected range must not overwrite this one
    api(`/trackers/${id}/history?range=${range}`).then((h) => { if (current) setHistory(h); }).catch(() => {});
    return () => { current = false; };
  }, [id, range, tick]);
  useEffect(() => {
    if (!results?.inProgress) return;
    const h = setInterval(() => setTick((n) => n + 1), 3000); // partial results arrive while it runs
    return () => clearInterval(h);
  }, [results?.inProgress]);
  // "search started" ends when the search does
  useEffect(() => { if (results && !results.inProgress) setMsg(''); }, [results]);

  const searchNow = async () => {
    setMsg(''); setError(''); setRequesting(true);
    try {
      await api(`/trackers/${id}/search`, { method: 'POST' });
      await load(); // the run exists as QUEUED right away → inProgress → polling starts
      setMsg(t.searchQueued);
    } catch (e: any) { setError(e.message); }
    finally { setRequesting(false); }
  };

  if (loadError && !tracker) return <AppShell crumb={t.trackersNav}><div className="error" role="alert">{loadError}</div></AppShell>;
  if (!tracker) return <AppShell crumb={t.trackersNav}><div className="card skeleton" /></AppShell>;

  const a = trends?.analysis;
  const cur = tracker.currency;
  const runStatus = results?.run?.status;
  // lazy results: while a search runs, what it has found so far replaces the previous run's list
  const progress = results?.inProgress ? results?.progress : null;
  const partial = progress?.offers?.length > 0;
  const shownOffers: any[] = partial ? progress.offers : results?.offers ?? [];
  const pctFmt = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const pctStr = (p: number | null) => (p == null ? '—' : pctFmt.format(p / 100));
  const points: { price: number }[] = history?.points ?? [];
  const chartLabel = points.length
    ? t.chartSummary(points.length, money(Math.min(...points.map((p) => p.price)), cur, locale), money(Math.max(...points.map((p) => p.price)), cur, locale))
    : t.priceHistory;

  return (
    <AppShell crumb={`${tracker.originAirport} → ${tracker.country.name[locale]}`}>
      <div className="page-head" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">LLB • {t.trackersNav}</div>
          <div className="row" style={{ gap: 14 }}>
            <Flag code={tracker.destinationCountry} />
            <h1 style={{ margin: 0 }}>{tracker.originAirport} → {tracker.country.name[locale]}</h1>
            <StatusPill tr={tracker} />
          </div>
        </div>
        <div className="row">
          <Link className="btn" href={`/trackers/${id}/edit`}>{t.edit}</Link>
          <button className="btn primary" onClick={searchNow} disabled={tracker.status !== 'ACTIVE' || tracker.expired || requesting || results?.inProgress}>
            {requesting || results?.inProgress ? t.searching : t.searchNow}
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {tracker.name && <><b>{tracker.name}</b> · </>}
        {dateRange(tracker.departureDate, tracker.returnDate, locale)} · {(t as any)[tracker.cabinClass]} ·{' '}
        <span aria-hidden="true">{tracker.adults} 👤</span><span className="sr-only">{t.adultsCount(tracker.adults)}</span> ·{' '}
        {tracker.maxStops === 0 ? t.direct : tracker.maxStops === 1 ? t.upTo1 : t.upTo2}
        {tracker.lastSuccessfulCheckAt && <> · {t.lastCheck}: {fmtDateTime(tracker.lastSuccessfulCheckAt, locale)}</>}
      </p>
      {tracker.expired && <div className="notice">{t.expiredHint}</div>}
      {msg && <div className="notice" role="status">{msg}</div>}
      {(error || loadError) && <div className="error" role="alert">{error || loadError}</div>}

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
            {a.priceLevel && (
              <span className={`chip ${a.priceLevel === 'low' ? 'ok' : a.priceLevel === 'high' ? 'bad' : ''}`}>
                {(t as any)[`level_${a.priceLevel}`]}
                {a.typicalRange && <> · {t.typicalRange(`${money(a.typicalRange[0], cur, locale)}–${money(a.typicalRange[1], cur, locale)}`)}</>}
              </span>
            )}
          </div>
          {a.cheapestRouteChanged && <p className="small muted">ℹ️ {t.routeChanged(a.previousBestDestination, a.bestDestination)}</p>}
          {a.cheapestRouteChanged && a.sameRoute?.changePct != null && <p className="small muted">{t.sameRoute(pctStr(a.sameRoute.changePct))}</p>}
        </div>
      )}

      <h2>{t.cheapest}</h2>
      {progress && (
        <div className="notice" role="status">
          {t.searchProgress((t as any)[`stage_${progress.stage}`] ?? progress.stage, progress.done, progress.total)}
          {partial && <div className="small muted">{t.partialHint}</div>}
        </div>
      )}
      <div className="card table-wrap" style={{ padding: 8 }} aria-busy={!!results?.inProgress}>
        {!results?.run && !partial && <p className="muted" style={{ padding: 8 }}>{t.notYet}</p>}
        {results?.run && !partial && results.offers.length === 0 && runStatus !== 'FAILED' && <p className="muted" style={{ padding: 8 }}>{t.noOffers}</p>}
        {shownOffers.length > 0 && (
          <table>
            <thead>
              <tr><th>{t.destination}</th><th>{t.dates}</th><th className="hide-sm">{t.airline}</th><th>{t.stops}</th><th className="num">{t.price}</th><th className="hide-sm">{t.checkedAt}</th><th><span className="sr-only">{t.actions}</span></th></tr>
            </thead>
            <tbody>
              {shownOffers.slice(0, 15).map((o: any) => (
                <tr key={o.id}>
                  <td><b>{o.destinationCity?.[locale] ?? o.destinationAirport}</b> <span className="muted small">{o.destinationAirport}</span></td>
                  <td className="small">{o.segments?.outbound?.length ? <LegTimes segments={o.segments} outboundMin={o.outboundDurationMin} inboundMin={o.inboundDurationMin} /> : dateRange(o.departureDate, o.returnDate, locale)}</td>
                  <td className="small hide-sm">{o.airline ?? '—'}</td>
                  <td className="small">{o.segments?.outbound?.length ? <LegStops segments={o.segments} places={results.places} outboundStops={o.outboundStops} inboundStops={o.inboundStops} /> : <>{o.outboundStops} {t.out} / {o.inboundStops} {t.back}</>}</td>
                  <td className="num">
                    <b>{money(o.price, o.currency, locale)}</b>
                    {o.originalCurrency && o.originalCurrency !== o.currency && (
                      <div className="small muted">{t.sourcePrice(money(o.originalPrice, o.originalCurrency, locale))}</div>
                    )}
                    {o.provider === 'mock'
                      ? <div className="small" style={{ color: 'var(--warn)' }} title={t.demoHint}>{t.demo}</div>
                      : o.priceStatus === 'INDICATIVE'
                      ? <div className="small" style={{ color: 'var(--warn)' }} title={t.indicativeHint}>~ {t.indicative}</div>
                      : <div className="small muted">{t.live}</div>}
                    {o.baggageIncluded === false && o.baggagePrice != null && <div className="small muted">{t.baggage}: {t.bagExtra(money(o.baggagePrice, o.currency, locale))}</div>}
                    {o.baggageIncluded === true && <div className="small muted">{t.baggage}: {t.bagIncluded}</div>}
                  </td>
                  <td className="small muted hide-sm">{fmtDateTime(o.observedAt, locale)}</td>
                  <td>
                    {/* a real link (new tab, middle-click, copy); the "price may have changed" note is its tooltip, no confirm() */}
                    {o.bookingUrl && (
                      <a className="btn sm" href={o.bookingUrl} target="_blank" rel="noopener noreferrer" title={t.flightLinkHint(fmtDateTime(o.observedAt, locale))}>
                        {t.viewFlight}<span className="sr-only"> {t.newTab}</span>
                      </a>
                    )}
                  </td>
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
            <button key={r} className={range === r ? 'on' : ''} aria-pressed={range === r} onClick={() => setRange(r)}>{r === '7' ? t.d7 : r === '30' ? t.d30 : t.all}</button>
          ))}
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }} role="img" aria-label={chartLabel}>
        <PriceChart points={history?.points ?? []} googlePoints={history?.googlePoints ?? []} currency={cur} locale={locale} />
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
                <td className="num">{money(r.minPrice, r.currency ?? cur, locale)}</td>
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
