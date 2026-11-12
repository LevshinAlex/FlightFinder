/**
 * Provider probe – the TLV → country prototype from docs/PROVIDER_EVALUATION.md.
 * Runs the same plan against every configured provider SEPARATELY (no failover / gap filling)
 * and writes a comparison report: requests spent, failures, prices per route, carrier coverage
 * (El Al, Arkia, Israir, low-costs).
 *
 * Budget: --requests N per provider (default 1). Enforced twice – by planning the calls and by a
 * fetch guard that refuses, without sending, any request over a provider's budget.
 * With 1 request, Google Flights providers (serpapi, hasdata) read only the outbound page:
 * real outbound legs + round-trip price, return legs unknown.
 *
 * Without --yes it is a DRY RUN: prints the plan and the budget, calls nothing.
 *
 *   npm run probe -w apps/api                       # dry run, TLV → IT, ~60 days ahead, 1 request / provider
 *   npm run probe -w apps/api -- --yes              # spend 1 request per provider
 *   npm run probe -w apps/api -- --requests 4 --dep 2027-05-10 --ret 2027-05-20 --yes
 *
 * Options: --from TLV --to IT --dep/--ret YYYY-MM-DD --flex N (dep +N, ret −N) --stops 1 --adults 1
 *          --currency USD --airports FCO,MXP --indicative a,b --live a,b --requests N --include-mock --yes
 */
import * as fs from 'fs';
import * as path from 'path';
import { AirportsService } from '../src/airports/airports.service';
import { addDays, toIsoDate } from '../src/common/dates';
import { FlightProvider, ProviderOffer, SearchCriteria } from '../src/providers/flight-provider.interface';
import { ProviderRegistry } from '../src/providers/provider.registry';
import { withCurrencyNormalization } from '../src/providers/currency';
import { config } from '../src/common/config';
import { buildDateCombinations } from '../src/search/date-combinations';
import { allCriteria } from '../src/search/search-planner';
import {
  chooseLiveTargets, compareByRoute, installRequestGuard, LIVE_REQUESTS_PER_CHECK, planIndicativeCalls, ProviderStats,
  renderMarkdown, summarize,
} from './probe-lib';

/** Airports probed first (busiest from TLV); the rest follow in directory order. */
const PRIORITY_AIRPORTS: Record<string, string[]> = { IT: ['FCO', 'MXP', 'VCE', 'NAP', 'BGY'] };

type OutboundCapable = FlightProvider & { searchOutboundOnly?: (c: SearchCriteria) => Promise<ProviderOffer[]> };

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
    currency: (get('currency') ?? config.baseCurrency).toUpperCase(), // providers quoting another currency are converted
    airports: list('airports'),
    indicative: list('indicative'),
    live: list('live'),
    requests: Math.max(1, Math.floor(Number(get('requests') ?? 1))),
    includeMock: a.includes('--include-mock'),
    yes: a.includes('--yes'),
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ v?: T; err?: string; ms: number }> {
  const t = Date.now();
  try { return { v: await fn(), ms: Date.now() - t }; } catch (e: any) { return { err: String(e?.message ?? e), ms: Date.now() - t }; }
}

/** How a live provider spends its budget: full checks, or one outbound-only page. */
function livePlan(p: OutboundCapable, budget: number): { checks: number; outboundOnly: boolean; requests: number } {
  const per = LIVE_REQUESTS_PER_CHECK[p.name] ?? 1;
  const checks = Math.floor(budget / per);
  if (checks === 0 && p.searchOutboundOnly) return { checks: 1, outboundOnly: true, requests: 1 };
  return { checks, outboundOnly: false, requests: checks * per };
}

async function main() {
  const o = args();
  const registry = new ProviderRegistry();
  const all = new AirportsService().resolveDestinationAirports(o.to, o.airports ?? []);
  const priority = PRIORITY_AIRPORTS[o.to] ?? [];
  const airports = [...priority.filter((a) => all.includes(a)), ...all.filter((a) => !priority.includes(a))];
  const combinations = buildDateCombinations({ date: o.dep, flexDays: o.flex, mode: 'PLUS' }, { date: o.ret, flexDays: o.flex, mode: 'MINUS' });
  const criteria = allCriteria({
    trackerId: 'probe', origin: o.from, destinations: airports, combinations,
    adults: o.adults, cabinClass: 'ECONOMY', currency: o.currency, maxStops: o.stops,
  });

  // Providers: explicit lists, or every configured one with the capability
  const skipped: string[] = [];
  const pick = async (names: string[] | undefined, cap: 'indicativePrices' | 'liveSearch') => {
    const out: OutboundCapable[] = [];
    for (const p of names ? names.map((n) => registry.get(n)) : registry.list()) {
      if (!p.capabilities[cap]) { if (names) skipped.push(`${p.name} (no ${cap})`); continue; }
      if (p.name === 'mock' && !o.includeMock && !names?.includes('mock')) continue;
      if (!(await p.getProviderStatus()).configured) { skipped.push(`${p.name} (no key)`); continue; }
      out.push(withCurrencyNormalization(p));
    }
    return out;
  };
  const indProviders = await pick(o.indicative, 'indicativePrices');
  let liveProviders = await pick(o.live, 'liveSearch');

  // The budget is PER PROVIDER (one API key) – a provider used in both stages shares it:
  // indicative goes first only if the provider is not also needed for the live check.
  const liveNames = new Set(liveProviders.map((p) => p.name));
  const indBudget = (p: FlightProvider) => (liveNames.has(p.name) ? 0 : o.requests);
  const indCalls = new Map(indProviders.map((p) => [p.name, planIndicativeCalls(p.name, airports, combinations, indBudget(p))]));
  const usedByInd = (name: string) => (indCalls.get(name) ?? []).reduce((n, c) => n + c.requests, 0);
  const livePlans = new Map(liveProviders.map((p) => [p.name, livePlan(p, o.requests - usedByInd(p.name))]));
  liveProviders = liveProviders.filter((p) => livePlans.get(p.name)!.checks > 0);
  const maxChecks = Math.max(0, ...[...livePlans.values()].map((x) => x.checks));

  console.log(`\nPlan: ${o.from} → ${o.to} | ${airports.length} airports | ${combinations.length} date pairs | ≤${o.stops} stops | ${o.adults} adult(s) | ${o.currency}`);
  console.log(`\nBudget: ${o.requests} request(s) per provider`);
  for (const p of indProviders) {
    const calls = indCalls.get(p.name)!;
    if (!calls.length) { console.log(`  ${p.name.padEnd(14)} indicative  skipped – its budget goes to the live check`); continue; }
    console.log(`  ${p.name.padEnd(14)} indicative  ${usedByInd(p.name)} request(s): ${calls.map((c) => `${c.destination} ×${c.combinations.length} dates`).join(', ')}`);
  }
  for (const p of liveProviders) {
    const lp = livePlans.get(p.name)!;
    console.log(`  ${p.name.padEnd(14)} live        ${lp.requests} request(s): ${lp.checks} check(s)${lp.outboundOnly ? ' – outbound page only (return legs need a 2nd request)' : ''}`);
  }
  if (skipped.length) console.log(`  skipped: ${[...new Set(skipped)].join(', ')}`);
  if (!indProviders.length && !liveProviders.length) {
    console.log('\nNo configured providers. Put keys into .env (IGNAV_API_KEY, SERPAPI_KEY, HASDATA_API_KEY, TRAVELPAYOUTS_TOKEN, DUFFEL_ACCESS_TOKEN).');
    return;
  }
  if (!o.yes) { console.log('\nDry run – nothing was requested. Add --yes to run.'); return; }

  const guard = installRequestGuard(o.requests);
  const stats: ProviderStats[] = [];
  const results: Record<string, ProviderOffer[]> = {};

  // Stage 1 – indicative, each provider separately
  const indicativeAll: ProviderOffer[] = [];
  for (const p of indProviders) {
    const calls = indCalls.get(p.name)!;
    if (!calls.length) continue;
    const offers: ProviderOffer[] = []; const errors: string[] = []; let failed = 0, ms = 0;
    for (const c of calls) {
      const r = await timed(() => p.getIndicativePrices({
        origin: o.from, destinations: [c.destination], combinations: c.combinations,
        adults: o.adults, cabinClass: 'ECONOMY', currency: o.currency, maxStops: o.stops,
      }));
      ms += r.ms;
      if (r.err) { failed++; errors.push(r.err); } else offers.push(...r.v!);
    }
    console.log(`  ${p.name} indicative: ${offers.length} offers, ${failed} failed`);
    stats.push(summarize(p.name, 'indicative', offers, o.stops, o.currency, guard.used[p.name] ?? usedByInd(p.name), failed, errors, ms));
    indicativeAll.push(...offers);
    results[`${p.name} (ind)`] = offers;
  }

  // Stage 2 – the SAME targets for every live provider (a provider takes as many as its budget allows)
  const targets = chooseLiveTargets(criteria, indicativeAll, o.stops, o.currency, priority.length ? priority : airports.slice(0, 5), maxChecks);
  for (const p of liveProviders) {
    const lp = livePlans.get(p.name)!;
    const offers: ProviderOffer[] = []; const errors: string[] = []; let failed = 0, ms = 0;
    const mine = targets.slice(0, lp.checks);
    for (const t of mine) {
      const r = await timed(() => (lp.outboundOnly ? p.searchOutboundOnly!(t) : p.searchFlights(t)));
      ms += r.ms;
      if (r.err) { failed++; errors.push(r.err); } else offers.push(...r.v!);
    }
    console.log(`  ${p.name} live: ${offers.length} offers, ${failed}/${mine.length} failed`);
    const s = summarize(p.name, 'live', offers, o.stops, o.currency, guard.used[p.name] ?? 0, failed, errors, ms);
    if (lp.outboundOnly) s.note = 'outbound only';
    stats.push(s);
    results[p.name] = offers;
  }
  guard.restore();

  const blocked = Object.entries(guard.blocked);
  if (blocked.length) console.log(`  guard blocked: ${blocked.map(([k, v]) => `${k} ×${v}`).join(', ')}`);

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
  fs.writeFileSync(`${base}.json`, JSON.stringify({ ...report, requestsUsed: guard.used, offers: results }, null, 2));
  console.log(`\nRequests used: ${Object.entries(guard.used).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  console.log(`Report: ${base}.md\n        ${base}.json`);
}

// exit explicitly: the quota counters' Redis connection would keep the process alive after the report
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
