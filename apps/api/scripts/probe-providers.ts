/**
 * Provider probe – the TLV → country prototype from docs/PROVIDER_EVALUATION.md.
 * Runs the same plan against every configured provider SEPARATELY (no failover / gap filling)
 * and writes a comparison report: requests spent, failures, prices per route, carrier coverage
 * (El Al, Arkia, Israir, low-costs).
 *
 * Without --yes it is a DRY RUN: prints the plan and the request budget, calls nothing.
 *
 *   npm run probe -w apps/api                           # dry run, TLV → IT, ~60 days ahead
 *   npm run probe -w apps/api -- --yes                  # spend requests
 *   npm run probe -w apps/api -- --to GR --dep 2027-05-10 --ret 2027-05-20 --flex 2 --max-live 3 --yes
 *
 * Options: --from TLV --to IT --dep/--ret YYYY-MM-DD --flex N (dep +N, ret −N) --stops 1 --adults 1
 *          --currency ILS --airports FCO,MXP --indicative a,b --live a,b --max-live 5 --include-mock --yes
 */
import * as fs from 'fs';
import * as path from 'path';
import { AirportsService } from '../src/airports/airports.service';
import { addDays, toIsoDate } from '../src/common/dates';
import { FlightProvider, ProviderOffer, SearchCriteria } from '../src/providers/flight-provider.interface';
import { ProviderRegistry } from '../src/providers/provider.registry';
import { buildDateCombinations } from '../src/search/date-combinations';
import { allCriteria, TrackerSearchPlan } from '../src/search/search-planner';
import {
  chooseLiveTargets, compareByRoute, indicativeRequests, LIVE_REQUESTS_PER_CHECK, ProviderStats, renderMarkdown, summarize,
} from './probe-lib';

const FALLBACK_AIRPORTS: Record<string, string[]> = { IT: ['FCO', 'MXP', 'VCE', 'NAP', 'BGY'] };

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const list = (k: string) => get(k)?.split(',').map((s) => s.trim()).filter(Boolean);
  const today = toIsoDate(new Date());
  return {
    from: (get('from') ?? 'TLV').toUpperCase(),
    to: (get('to') ?? 'IT').toUpperCase(),
    dep: get('dep') ?? addDays(today, 60),
    ret: get('ret') ?? addDays(today, 70),
    flex: Number(get('flex') ?? 2),
    stops: Number(get('stops') ?? 1),
    adults: Number(get('adults') ?? 1),
    currency: (get('currency') ?? 'ILS').toUpperCase(),
    airports: list('airports'),
    indicative: list('indicative'),
    live: list('live'),
    maxLive: Number(get('max-live') ?? 5),
    includeMock: a.includes('--include-mock'),
    yes: a.includes('--yes'),
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ v?: T; err?: string; ms: number }> {
  const t = Date.now();
  try { return { v: await fn(), ms: Date.now() - t }; } catch (e: any) { return { err: String(e?.message ?? e), ms: Date.now() - t }; }
}

async function main() {
  const o = args();
  const registry = new ProviderRegistry();
  const airportsSvc = new AirportsService();
  const airports = airportsSvc.resolveDestinationAirports(o.to, o.airports ?? []);
  const combinations = buildDateCombinations({ date: o.dep, flexDays: o.flex, mode: 'PLUS' }, { date: o.ret, flexDays: o.flex, mode: 'MINUS' });
  const plan: TrackerSearchPlan = {
    trackerId: 'probe', origin: o.from, destinations: airports, combinations,
    adults: o.adults, cabinClass: 'ECONOMY', currency: o.currency, maxStops: o.stops,
  };

  // Providers: explicit lists, or every configured one with the capability
  const skipped: string[] = [];
  const pick = async (names: string[] | undefined, cap: 'indicativePrices' | 'liveSearch') => {
    const out: FlightProvider[] = [];
    for (const p of names ? names.map((n) => registry.get(n)) : registry.list()) {
      if (!p.capabilities[cap]) { if (names) skipped.push(`${p.name} (no ${cap})`); continue; }
      if (p.name === 'mock' && !o.includeMock && !names?.includes('mock')) continue;
      if (!(await p.getProviderStatus()).configured) { skipped.push(`${p.name} (no key)`); continue; }
      out.push(p);
    }
    return out;
  };
  const indProviders = await pick(o.indicative, 'indicativePrices');
  const liveProviders = await pick(o.live, 'liveSearch');

  const maxTargets = Math.min(o.maxLive, airports.length * combinations.length);
  console.log(`\nPlan: ${o.from} → ${o.to} | ${airports.length} airports (${airports.join(',')}) | ${combinations.length} date pairs | ≤${o.stops} stops | ${o.adults} adult(s) | ${o.currency}`);
  console.log('\nRequest budget:');
  for (const p of indProviders) console.log(`  ${p.name.padEnd(14)} indicative  ~${indicativeRequests(p.name, airports.length, combinations)} requests`);
  for (const p of liveProviders) console.log(`  ${p.name.padEnd(14)} live        ≤${maxTargets * (LIVE_REQUESTS_PER_CHECK[p.name] ?? 1)} requests (${maxTargets} checks)`);
  if (skipped.length) console.log(`  skipped: ${[...new Set(skipped)].join(', ')}`);
  if (!indProviders.length && !liveProviders.length) {
    console.log('\nNo configured providers. Put keys into .env (IGNAV_API_KEY, SERPAPI_KEY, HASDATA_API_KEY, TRAVELPAYOUTS_TOKEN, DUFFEL_ACCESS_TOKEN).');
    return;
  }
  if (!o.yes) { console.log('\nDry run – nothing was requested. Add --yes to run.'); return; }

  const stats: ProviderStats[] = [];
  const results: Record<string, ProviderOffer[]> = {};

  // Stage 1 – every indicative provider over all pairs (one call per airport, like the engine)
  const indicativeAll: ProviderOffer[] = [];
  for (const p of indProviders) {
    const offers: ProviderOffer[] = []; const errors: string[] = []; let failed = 0, ms = 0;
    for (const destination of airports) {
      const r = await timed(() => p.getIndicativePrices({
        origin: o.from, destinations: [destination], combinations, adults: o.adults, cabinClass: 'ECONOMY', currency: o.currency, maxStops: o.stops,
      }));
      ms += r.ms;
      if (r.err) { failed++; errors.push(r.err); } else offers.push(...r.v!);
    }
    console.log(`  ${p.name} indicative: ${offers.length} offers, ${failed} failed`);
    stats.push(summarize(p.name, 'indicative', offers, o.stops, o.currency, indicativeRequests(p.name, airports.length, combinations), failed, errors, ms));
    indicativeAll.push(...offers);
    if (!offers.every((x) => x.rankingOnly)) results[`${p.name} (ind)`] = offers;
  }

  // Stage 2 – the SAME targets for every live provider
  const targets: SearchCriteria[] = chooseLiveTargets(allCriteria(plan), indicativeAll, o.stops, o.currency, FALLBACK_AIRPORTS[o.to] ?? airports.slice(0, 5), maxTargets);
  for (const p of liveProviders) {
    const offers: ProviderOffer[] = []; const errors: string[] = []; let failed = 0, ms = 0;
    for (const t of targets) {
      const r = await timed(() => p.searchFlights(t));
      ms += r.ms;
      if (r.err) { failed++; errors.push(r.err); } else offers.push(...r.v!);
    }
    console.log(`  ${p.name} live: ${offers.length} offers, ${failed}/${targets.length} failed`);
    stats.push(summarize(p.name, 'live', offers, o.stops, o.currency, targets.length * (LIVE_REQUESTS_PER_CHECK[p.name] ?? 1), failed, errors, ms));
    results[p.name] = offers;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    plan: { origin: o.from, country: o.to, airports, combos: combinations.length, maxStops: o.stops, currency: o.currency, adults: o.adults },
    // with live providers, compare only the routes they checked (indicative-only rows are noise)
    stats, targets, skipped: [...new Set(skipped)],
    comparison: compareByRoute(results, o.stops, o.currency)
      .filter((row) => !liveProviders.length || liveProviders.some((p) => row.prices[p.name] != null)),
  };
  const dir = path.resolve(__dirname, '..', 'probe-reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${o.from}-${o.to}-${report.generatedAt.replace(/[:.]/g, '-')}`);
  fs.writeFileSync(`${base}.md`, renderMarkdown(report));
  fs.writeFileSync(`${base}.json`, JSON.stringify({ ...report, offers: results }, null, 2));
  console.log(`\nReport: ${base}.md\n        ${base}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
