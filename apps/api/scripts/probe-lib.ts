/**
 * Pure part of the provider probe (stage 1 of the spec: choose the flight data source).
 * No I/O – unit-tested in test/probe.spec.ts.
 */
import { ProviderOffer, SearchCriteria } from '../src/providers/flight-provider.interface';
import { cheapestPerRoute, filterOffers, offerRouteKey } from '../src/search/search-planner';

/** Carriers whose presence answers "does this source really cover Tel Aviv?" */
export const WATCHED_CARRIERS: Record<string, { name: string; group: 'israeli' | 'lowcost' }> = {
  LY: { name: 'El Al', group: 'israeli' },
  IZ: { name: 'Arkia', group: 'israeli' },
  '6H': { name: 'Israir', group: 'israeli' },
  W6: { name: 'Wizz Air', group: 'lowcost' },
  W4: { name: 'Wizz Air Malta', group: 'lowcost' },
  W9: { name: 'Wizz Air UK', group: 'lowcost' },
  '5W': { name: 'Wizz Air Abu Dhabi', group: 'lowcost' },
  FR: { name: 'Ryanair', group: 'lowcost' },
  RK: { name: 'Ryanair UK', group: 'lowcost' },
  U2: { name: 'easyJet', group: 'lowcost' },
  EC: { name: 'easyJet Europe', group: 'lowcost' },
  DS: { name: 'easyJet Switzerland', group: 'lowcost' },
  VY: { name: 'Vueling', group: 'lowcost' },
  V7: { name: 'Volotea', group: 'lowcost' },
};

/** Requests a live check costs: Google Flights scrapers need an extra return-page request. */
export const LIVE_REQUESTS_PER_CHECK: Record<string, number> = { serpapi: 2, hasdata: 2 };

const DAY = 86_400_000;
const stay = (dep: string, ret: string) => Math.round((Date.parse(ret) - Date.parse(dep)) / DAY);

/** Rough request count of one indicative pass (for the dry-run budget). */
export function indicativeRequests(provider: string, airports: number, combos: { departureDate: string; returnDate: string }[]): number {
  if (provider === 'ignav') return airports * new Set(combos.map((c) => stay(c.departureDate, c.returnDate))).size;
  return airports * combos.length; // travelpayouts: one request per airport × date pair
}

/** IATA carrier codes seen in an offer (from flight numbers like "AZ811" / "6H123"). */
export function carrierCodes(o: ProviderOffer): string[] {
  const segs = [...(o.segments?.outbound ?? []), ...(o.segments?.inbound ?? [])];
  const codes = segs.map((s) => /^([A-Z0-9]{2})\d/.exec(s.flightNumber ?? '')?.[1]).filter((x): x is string => !!x);
  return [...new Set(codes)];
}

/**
 * Live targets, identical for every live provider so their prices are comparable:
 * the cheapest indicative routes first, then one middle-date probe per fallback airport.
 */
export function chooseLiveTargets(
  all: SearchCriteria[], indicative: ProviderOffer[], maxStops: number, currency: string, fallbackAirports: string[], max: number,
): SearchCriteria[] {
  const byRoute = new Map(all.map((c) => [`${c.destination}|${c.departureDate}|${c.returnDate}`, c]));
  const chosen = new Map<string, SearchCriteria>();
  const ranked = [...cheapestPerRoute(filterOffers(indicative, maxStops, currency)).values()].sort((a, b) => a.price - b.price);
  for (const o of ranked) {
    if (chosen.size >= max) break;
    const k = `${o.destination}|${o.departureDate}|${o.returnDate}`;
    const c = byRoute.get(k);
    if (c) chosen.set(k, c);
  }
  for (const a of fallbackAirports) {
    if (chosen.size >= max) break;
    if ([...chosen.values()].some((x) => x.destination === a)) continue;
    const own = all.filter((c) => c.destination === a); // middle date pair of THIS airport
    const c = own[Math.floor(own.length / 2)];
    if (c) chosen.set(`${a}|${c.departureDate}|${c.returnDate}`, c);
  }
  return [...chosen.values()];
}

export interface ProviderStats {
  provider: string;
  stage: 'indicative' | 'live';
  requests: number;
  failed: number;
  errors: string[];
  offers: number;
  usableOffers: number;
  ms: number;
  carriers: Record<string, number>;
}

export function summarize(
  provider: string, stage: 'indicative' | 'live', offers: ProviderOffer[], maxStops: number, currency: string,
  requests: number, failed: number, errors: string[], ms: number,
): ProviderStats {
  const usable = filterOffers(offers.filter((o) => !o.rankingOnly), maxStops, currency);
  const carriers: Record<string, number> = {};
  for (const o of usable) for (const c of carrierCodes(o)) carriers[c] = (carriers[c] ?? 0) + 1;
  return { provider, stage, requests, failed, errors: [...new Set(errors)].slice(0, 5), offers: offers.length, usableOffers: usable.length, ms, carriers };
}

/** Cheapest usable price per route and provider → comparison table rows. */
export function compareByRoute(results: Record<string, ProviderOffer[]>, maxStops: number, currency: string) {
  const rows = new Map<string, Record<string, number>>();
  for (const [provider, offers] of Object.entries(results)) {
    for (const o of cheapestPerRoute(filterOffers(offers.filter((x) => !x.rankingOnly), maxStops, currency)).values()) {
      const k = offerRouteKey(o);
      if (!rows.has(k)) rows.set(k, {});
      rows.get(k)![provider] = o.price;
    }
  }
  return [...rows.entries()].map(([route, prices]) => {
    const vals = Object.values(prices);
    const min = Math.min(...vals);
    return { route, prices, cheapestBy: Object.keys(prices).filter((p) => prices[p] === min), spreadPct: vals.length > 1 ? Math.round(((Math.max(...vals) - min) / min) * 1000) / 10 : null };
  }).sort((a, b) => Math.min(...Object.values(a.prices)) - Math.min(...Object.values(b.prices)));
}

export function renderMarkdown(r: {
  generatedAt: string; plan: { origin: string; country: string; airports: string[]; combos: number; maxStops: number; currency: string; adults: number };
  stats: ProviderStats[]; targets: SearchCriteria[]; comparison: ReturnType<typeof compareByRoute>; skipped: string[];
}): string {
  const L: string[] = [];
  L.push(`# Provider probe: ${r.plan.origin} → ${r.plan.country}`, '');
  L.push(`${r.generatedAt} · ${r.plan.airports.length} airports · ${r.plan.combos} date pairs · ≤${r.plan.maxStops} stops each way · ${r.plan.adults} adult(s) · ${r.plan.currency}`, '');
  if (r.skipped.length) L.push(`Skipped (no key / not supported): ${r.skipped.join(', ')}`, '');

  L.push('## Providers', '', '| Provider | Stage | Requests | Failed | Offers (usable) | Time |', '|---|---|---:|---:|---:|---:|');
  for (const s of r.stats) L.push(`| ${s.provider} | ${s.stage} | ${s.requests} | ${s.failed} | ${s.offers} (${s.usableOffers}) | ${(s.ms / 1000).toFixed(1)} s |`);
  const errs = r.stats.filter((s) => s.errors.length);
  if (errs.length) { L.push('', '**Errors:**'); for (const s of errs) for (const e of s.errors) L.push(`- ${s.provider}: ${e}`); }

  const live = r.stats.filter((s) => s.stage === 'live');
  if (live.length) {
    L.push('', '## Carrier coverage (live, usable offers)', '', `| Carrier | ${live.map((s) => s.provider).join(' | ')} |`, `|---|${live.map(() => '---:').join('|')}|`);
    for (const [code, c] of Object.entries(WATCHED_CARRIERS)) {
      L.push(`| ${c.group === 'israeli' ? '🇮🇱 ' : ''}${c.name} (${code}) | ${live.map((s) => s.carriers[code] ?? '—').join(' | ')} |`);
    }
    const other = [...new Set(live.flatMap((s) => Object.keys(s.carriers)))].filter((c) => !WATCHED_CARRIERS[c]).sort();
    if (other.length) L.push('', `Other carriers seen: ${other.join(', ')}`);
    L.push('', '_No offers with a carrier ≠ the carrier does not fly the route; it may simply not be the cheapest on these dates._');
  }

  if (r.targets.length) {
    L.push('', '## Live targets', '', ...r.targets.map((t) => `- ${t.origin}→${t.destination} ${t.departureDate} / ${t.returnDate}`));
  }
  if (r.comparison.length) {
    const providers = [...new Set(r.comparison.flatMap((x) => Object.keys(x.prices)))];
    L.push('', '## Cheapest price per route', '', `| Route | ${providers.join(' | ')} | Spread |`, `|---|${providers.map(() => '---:').join('|')}|---:|`);
    for (const row of r.comparison.slice(0, 30)) {
      L.push(`| ${row.route} | ${providers.map((p) => (row.prices[p] == null ? '—' : row.cheapestBy.includes(p) ? `**${row.prices[p]}**` : String(row.prices[p]))).join(' | ')} | ${row.spreadPct == null ? "—" : `${row.spreadPct}%`} |`);
    }
  }
  return L.join('\n') + '\n';
}
