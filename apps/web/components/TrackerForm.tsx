'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, Country, getCountries } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Mode = 'PLUS' | 'MINUS' | 'BOTH';
export interface TrackerValues {
  name: string; originCountry: string; originAirport: string; destinationCountry: string; destinationAirports: string[];
  departureDate: string; returnDate: string; departureFlexDays: number; departureFlexMode: Mode; returnFlexDays: number; returnFlexMode: Mode;
  maxStops: number; adults: number; cabinClass: string; currency: string; targetPrice: string; significantChangePct: number;
}

const plusDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const defaults = (): TrackerValues => ({
  name: '', originCountry: 'IL', originAirport: 'TLV', destinationCountry: '', destinationAirports: [],
  departureDate: plusDays(60), returnDate: plusDays(70), departureFlexDays: 2, departureFlexMode: 'PLUS', returnFlexDays: 2, returnFlexMode: 'MINUS',
  maxStops: 1, adults: 1, cabinClass: 'ECONOMY', currency: 'ILS', targetPrice: '', significantChangePct: 2,
});

const FLEX = ['0:PLUS', '1:PLUS', '2:PLUS', '3:PLUS', '1:MINUS', '2:MINUS', '3:MINUS', '1:BOTH', '2:BOTH', '3:BOTH'];
const flexLabel = (v: string, exact: string) => {
  const [n, m] = v.split(':');
  if (n === '0') return exact;
  return `${m === 'PLUS' ? '+' : m === 'MINUS' ? '−' : '±'}${n}`;
};

/** Mirrors the backend date-combination logic for the live counter. */
function expand(date: string, n: number, mode: Mode) {
  const out: string[] = [];
  for (let i = mode === 'PLUS' ? 0 : -n; i <= (mode === 'MINUS' ? 0 : n); i++) {
    const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function TrackerForm({ initial, trackerId }: { initial: TrackerValues; trackerId?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<TrackerValues>(initial);
  const [countries, setCountries] = useState<Country[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { getCountries().then(setCountries).catch((e) => setError(e.message)); }, []);
  const set = <K extends keyof TrackerValues>(k: K, val: TrackerValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const origin = countries.find((c) => c.code === v.originCountry);
  const dest = countries.find((c) => c.code === v.destinationCountry);
  const sorted = useMemo(() => [...countries].sort((a, b) => a.name[locale].localeCompare(b.name[locale], locale)), [countries, locale]);
  // The selected country always stays in the list: otherwise the controlled <select required>
  // has no matching option, the DOM value becomes '' and the browser silently blocks submit.
  const filtered = sorted.filter((c) => c.code === v.destinationCountry || !q || c.name.en.toLowerCase().includes(q.toLowerCase()) || c.name.ru.toLowerCase().includes(q.toLowerCase()) || c.code === q.toUpperCase());

  const combos = useMemo(() => {
    if (!v.departureDate || !v.returnDate) return 0;
    const deps = expand(v.departureDate, v.departureFlexDays, v.departureFlexMode);
    const rets = expand(v.returnDate, v.returnFlexDays, v.returnFlexMode);
    return deps.reduce((n, d) => n + rets.filter((r) => r > d).length, 0);
  }, [v.departureDate, v.returnDate, v.departureFlexDays, v.departureFlexMode, v.returnFlexDays, v.returnFlexMode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { ...v, targetPrice: v.targetPrice ? Number(v.targetPrice) : undefined, name: v.name || undefined };
      const res = await api(trackerId ? `/trackers/${trackerId}` : '/trackers', { method: trackerId ? 'PUT' : 'POST', json: body });
      router.push(`/trackers/${res.id}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  const toggleAirport = (iata: string) =>
    set('destinationAirports', v.destinationAirports.includes(iata) ? v.destinationAirports.filter((x) => x !== iata) : [...v.destinationAirports, iata]);

  return (
    <form className="card" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">{t.originCountry}
          <select value={v.originCountry} onChange={(e) => {
            const c = countries.find((x) => x.code === e.target.value);
            setV((s) => ({
              ...s, originCountry: e.target.value, originAirport: c?.airports[0]?.iata ?? '',
              ...(s.destinationCountry === e.target.value ? { destinationCountry: '', destinationAirports: [] } : {}),
            }));
          }}>
            {sorted.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name[locale]}</option>)}
          </select>
        </label>
        <label className="field">{t.originAirport}
          <select value={v.originAirport} onChange={(e) => set('originAirport', e.target.value)}>
            {origin?.airports.map((a) => <option key={a.iata} value={a.iata}>{a.city[locale]} — {a.iata}</option>)}
          </select>
        </label>
        <label className="field">{t.destCountry}
          <input type="search" placeholder={t.searchCountry} value={q} onChange={(e) => setQ(e.target.value)} />
          <select required value={v.destinationCountry} onChange={(e) => setV((s) => ({ ...s, destinationCountry: e.target.value, destinationAirports: [] }))}>
            <option value="">{t.chooseCountry}</option>
            {filtered.filter((c) => c.code !== v.originCountry).map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name[locale]}</option>)}
          </select>
        </label>
        <label className="field">{t.trackerName}<input maxLength={80} value={v.name} onChange={(e) => set('name', e.target.value)} /></label>

        <label className="field">{t.departureDate}<input type="date" required value={v.departureDate} onChange={(e) => set('departureDate', e.target.value)} /></label>
        <label className="field">{t.depFlex}
          <select value={`${v.departureFlexDays}:${v.departureFlexMode}`} onChange={(e) => { const [n, m] = e.target.value.split(':'); setV((s) => ({ ...s, departureFlexDays: +n, departureFlexMode: m as Mode })); }}>
            {FLEX.map((f) => <option key={f} value={f}>{flexLabel(f, t.exact)}</option>)}
          </select>
        </label>
        <label className="field">{t.returnDate}<input type="date" required min={v.departureDate} value={v.returnDate} onChange={(e) => set('returnDate', e.target.value)} /></label>
        <label className="field">{t.retFlex}
          <select value={`${v.returnFlexDays}:${v.returnFlexMode}`} onChange={(e) => { const [n, m] = e.target.value.split(':'); setV((s) => ({ ...s, returnFlexDays: +n, returnFlexMode: m as Mode })); }}>
            {FLEX.map((f) => <option key={f} value={f}>{flexLabel(f, t.exact)}</option>)}
          </select>
        </label>

        <label className="field">{t.maxStops}
          <select value={v.maxStops} onChange={(e) => set('maxStops', +e.target.value)}>
            <option value={0}>{t.direct}</option><option value={1}>{t.upTo1}</option><option value={2}>{t.upTo2}</option>
          </select>
        </label>
        <label className="field">{t.adults}<input type="number" min={1} max={9} value={v.adults} onChange={(e) => set('adults', Math.max(1, +e.target.value))} /></label>
        <label className="field">{t.cabin}
          <select value={v.cabinClass} onChange={(e) => set('cabinClass', e.target.value)}>
            {['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'].map((c) => <option key={c} value={c}>{(t as any)[c]}</option>)}
          </select>
        </label>
        <label className="field">{t.currency}
          <select value={v.currency} onChange={(e) => set('currency', e.target.value)}>
            {['ILS', 'USD', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">{t.targetPrice}<input type="number" min={1} value={v.targetPrice} onChange={(e) => set('targetPrice', e.target.value)} /></label>
        <label className="field">{t.threshold}<input type="number" min={0} max={50} step={0.5} value={v.significantChangePct} onChange={(e) => set('significantChangePct', +e.target.value)} /></label>
      </div>

      {dest && (
        <div style={{ marginTop: 16 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{t.destAirports}</div>
          <label className="check" style={{ marginBottom: 6 }}>
            <input type="checkbox" checked={v.destinationAirports.length === 0} onChange={() => set('destinationAirports', [])} /> {t.allAirports} ({dest.airports.length})
          </label>
          <div className="airport-list">
            {dest.airports.map((a) => (
              <label key={a.iata} className="check small">
                <input type="checkbox" checked={v.destinationAirports.includes(a.iata)} onChange={() => toggleAirport(a.iata)} />
                {a.city[locale]} ({a.iata})
              </label>
            ))}
          </div>
        </div>
      )}

      <p className="small muted">{t.combos(combos)}{dest ? ` × ${v.destinationAirports.length || dest.airports.length} ✈` : ''}</p>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || !v.destinationCountry || combos === 0}>{trackerId ? t.saveChanges : t.save}</button>
        <button type="button" className="btn" onClick={() => router.back()}>{t.cancel}</button>
      </div>
    </form>
  );
}
