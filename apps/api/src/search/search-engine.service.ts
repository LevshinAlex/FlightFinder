import { Injectable, Logger } from '@nestjs/common';
import { FlightTracker, Prisma, SearchTrigger } from '@prisma/client';
import { analyzePrices, CheapestPoint, HistoryPoint, PriceAnalysis } from '../analysis/price-analysis';
import { AirportsService } from '../airports/airports.service';
import { config } from '../common/config';
import { parseIsoDate, toIsoDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderNotSupportedError, ProviderOffer, SearchCriteria } from '../providers/flight-provider.interface';
import { ProviderRegistry } from '../providers/provider.registry';
import { createLimiter, withRetry } from '../providers/retry';
import { hasSearchableDates, trackerDateCombinations } from './date-combinations';
import { partialOffers, PROGRESS_INTERVAL_MS, PROGRESS_TTL_MIN, progressKey, RunProgress } from './run-progress';
import { ACTIVE_RUN_STATUSES, failUnfinishedRuns, INTERRUPTED_MESSAGE } from './run-state';
import { SearchCacheService } from './search-cache.service';
import {
  allCriteria, cheapestPerRoute, compareControl, ControlCheck, determineOutcome, filterOffers, indicativeKey, liveKey,
  offerRouteKey, pickControlCriteria, selectLiveCandidates, TrackerSearchPlan,
} from './search-planner';

/** Stops hammering a provider that is clearly down: after N consecutive failures, remaining calls fail fast. */
class CircuitBreaker {
  private consecutive = 0;
  constructor(private threshold = 8) {}
  get open() { return this.consecutive >= this.threshold; }
  success() { this.consecutive = 0; }
  failure() { this.consecutive++; }
}

type Result<T> = { ok: true; value: T; cached: boolean } | { ok: false; error: string };

export interface TrackerRunResult {
  trackerId: string;
  searchRunId: string;
  status: string;
  analysis: PriceAnalysis | null;
}

/**
 * Flight Search Engine.
 * 1) plan date combinations × destination airports for every tracker
 * 2) stage 1 – indicative prices for ALL combinations (deduplicated across trackers + cached)
 * 3) stage 2 – live check only of the most promising combinations (deduplicated + cached)
 * 4) filter by user criteria, store offers + snapshots, analyse trend
 * While it runs, each run's best offers so far are published (run-progress.ts) – the UI shows them at once.
 */
@Injectable()
export class SearchEngineService {
  private readonly log = new Logger(SearchEngineService.name);

  constructor(
    private prisma: PrismaService,
    private airports: AirportsService,
    private providers: ProviderRegistry,
    private cache: SearchCacheService,
  ) {}

  plan(t: FlightTracker, today = toIsoDate(new Date())): TrackerSearchPlan {
    return {
      trackerId: t.id,
      origin: t.originAirport,
      destinations: this.airports.resolveDestinationAirports(t.destinationCountry, t.destinationAirports),
      combinations: trackerDateCombinations(t, today),
      adults: t.adults,
      cabinClass: t.cabinClass,
      currency: t.currency,
      maxStops: t.maxStops,
    };
  }

  /**
   * `job` names the runs created for this job when it was queued (scheduler batch / enqueueTracker).
   * They are claimed QUEUED → RUNNING (see run-state.ts); without them new runs are created.
   */
  async runForTrackers(trackerIds: string[], trigger: SearchTrigger, job: { batchId?: string; runId?: string } = {}): Promise<TrackerRunResult[]> {
    const today = toIsoDate(new Date());
    const trackers = (await this.prisma.flightTracker.findMany({ where: { id: { in: trackerIds }, status: 'ACTIVE' } }))
      .filter((t) => hasSearchableDates(t, today));
    // this job's own runs: QUEUED – or RUNNING, when the job is re-delivered because its worker died
    const own: Prisma.SearchRunWhereInput | null = job.batchId ? { batchId: job.batchId } : job.runId ? { id: job.runId } : null;

    const runs = new Map<string, string>();
    for (const t of trackers) {
      const mine = own
        ? await this.prisma.searchRun.findFirst({ where: { AND: [own, { trackerId: t.id, status: { in: ACTIVE_RUN_STATUSES } }] } })
        : null;
      const run = mine
        ? await this.prisma.searchRun.update({ where: { id: mine.id }, data: { status: 'RUNNING', startedAt: new Date() } })
        : await this.prisma.searchRun.create({ data: { trackerId: t.id, trigger, batchId: job.batchId, status: 'RUNNING' } });
      runs.set(t.id, run.id);
    }
    // the job's other runs belong to trackers paused / past their dates since queueing: drop them (test #7)
    if (own) {
      await this.prisma.searchRun.deleteMany({
        where: { AND: [own, { id: { notIn: [...runs.values()] } }, { status: { in: ACTIVE_RUN_STATUSES } }] },
      });
    }
    if (!trackers.length) return [];

    try {
      return await this.execute(trackers, runs, job.batchId);
    } catch (e: any) {
      // finalize settles each run it reaches; whatever is left must not stay RUNNING with no worker behind it
      await failUnfinishedRuns(this.prisma, { id: { in: [...runs.values()] } }, `${INTERRUPTED_MESSAGE}: ${e.message}`);
      throw e;
    }
  }

  private async execute(trackers: FlightTracker[], runs: Map<string, string>, batchId?: string): Promise<TrackerRunResult[]> {
    const plans = trackers.map((t) => this.plan(t));
    const limit = createLimiter(config.providers.concurrency);
    let cacheHits = 0;
    const indicative = new Map<string, Result<ProviderOffer[]>>();
    const live = new Map<string, Result<ProviderOffer[]>>();
    const candidatesByTracker = new Map<string, SearchCriteria[]>();

    // ---------- Lazy results: publish what each run has found so far ----------
    const progress = { stage: 'indicative' as RunProgress['stage'], done: 0, total: 0, last: 0 };
    const publish = async (force = false) => {
      if (!force && Date.now() - progress.last < PROGRESS_INTERVAL_MS) return;
      progress.last = Date.now();
      await Promise.all(plans.map((p) => {
        const found = this.indicativeFor(p, indicative);
        for (const c of candidatesByTracker.get(p.trackerId) ?? []) { const r = live.get(liveKey(c)); if (r?.ok) found.push(...r.value); }
        const snapshot: RunProgress = {
          stage: progress.stage, done: progress.done, total: progress.total,
          offers: partialOffers(found, p.maxStops, p.currency), updatedAt: new Date().toISOString(),
        };
        return this.cache.set(progressKey(runs.get(p.trackerId)!), snapshot, PROGRESS_TTL_MIN);
      })).catch((e) => this.log.warn(`progress publish failed: ${e.message}`));
    };
    const startStage = (stage: RunProgress['stage'], total: number) => {
      Object.assign(progress, { stage, total, done: 0 });
      return publish(true);
    };
    const stepDone = () => { progress.done++; return publish(); };

    // ---------- Stage 1: indicative ----------
    const indicativeProvider = this.providers.indicative();
    if (indicativeProvider) {
      // group unique (origin,dest,pax,cabin,currency,stops) → set of date pairs
      const groups = new Map<string, { plan: TrackerSearchPlan; destination: string; combos: Map<string, { departureDate: string; returnDate: string }> }>();
      for (const p of plans)
        for (const d of p.destinations)
          for (const c of p.combinations) {
            const k = indicativeKey(p, d, c);
            if (indicative.has(k)) continue;
            const cached = await this.cache.get<ProviderOffer[]>(SearchCacheService.key('ind', indicativeProvider.name, { k }));
            if (cached) { indicative.set(k, { ok: true, value: cached, cached: true }); cacheHits++; continue; }
            const gk = [p.origin, d, p.adults, p.cabinClass, p.currency, p.maxStops].join('|');
            if (!groups.has(gk)) groups.set(gk, { plan: p, destination: d, combos: new Map() });
            groups.get(gk)!.combos.set(k, c);
          }

      const breaker = new CircuitBreaker();
      await startStage('indicative', groups.size);
      await Promise.all([...groups.values()].map((g) => limit(async () => {
        const keys = [...g.combos.keys()];
        if (breaker.open) { for (const k of keys) indicative.set(k, { ok: false, error: 'circuit open' }); return; }
        try {
          const offers = await withRetry(() => indicativeProvider.getIndicativePrices({
            origin: g.plan.origin, destinations: [g.destination], combinations: [...g.combos.values()],
            adults: g.plan.adults, cabinClass: g.plan.cabinClass, currency: g.plan.currency, maxStops: g.plan.maxStops,
          }));
          for (const k of keys) {
            const c = g.combos.get(k)!;
            const v = offers.filter((o) => o.departureDate === c.departureDate && o.returnDate === c.returnDate);
            indicative.set(k, { ok: true, value: v, cached: false });
            await this.cache.set(SearchCacheService.key('ind', indicativeProvider.name, { k }), v);
          }
          breaker.success();
        } catch (e: any) {
          breaker.failure();
          this.log.warn(`indicative ${g.destination} failed: ${e.message}`);
          for (const k of keys) indicative.set(k, { ok: false, error: e.message });
        }
        await stepDone();
      })));
      await publish(true);
    }

    // ---------- Stage 2: live check of promising candidates ----------
    const liveProvider = this.providers.live();
    for (const p of plans) {
      const ind = this.indicativeFor(p, indicative);
      const candidates = liveProvider
        ? indicativeProvider
          ? selectLiveCandidates(p, ind, config.providers.liveCheckTopN, config.providers.liveAirportProbes)
          : config.providers.liveAirportProbes
            ? allCriteria(p).slice(0, config.providers.liveCheckTopN * 3) // no stage 1: bounded brute force
            : selectLiveCandidates(p, [], config.providers.liveCheckTopN, false) // fixed budget: N middle-date checks
        : [];
      candidatesByTracker.set(p.trackerId, candidates);
    }
    const quotaLimited = new Set<string>(); // trackers that lost live checks to today's free quota
    if (liveProvider) {
      const unique = new Map<string, SearchCriteria>();
      for (const list of candidatesByTracker.values()) for (const c of list) unique.set(liveKey(c), c);
      // cached answers cost no quota
      for (const k of unique.keys()) {
        const cached = await this.cache.get<ProviderOffer[]>(SearchCacheService.key('live', liveProvider.name, { k }));
        if (cached) { live.set(k, { ok: true, value: cached, cached: true }); cacheHits++; }
      }
      // free quotas (budget.ts): request only what today's share allows – every tracker's best candidate first
      const allowed = this.withinAllowance(plans.map((p) => candidatesByTracker.get(p.trackerId)!), live, await this.providers.liveCheckAllowance());
      for (const p of plans) {
        const list = candidatesByTracker.get(p.trackerId)!;
        const kept = list.filter((c) => live.has(liveKey(c)) || allowed.has(liveKey(c)));
        if (kept.length < list.length) { quotaLimited.add(p.trackerId); candidatesByTracker.set(p.trackerId, kept); }
      }
      if (quotaLimited.size) this.log.warn(`free API quota: live checks cut for ${quotaLimited.size} tracker(s)`);
      const breaker = new CircuitBreaker();
      await startStage('live', allowed.size);
      await Promise.all([...allowed].map((k) => limit(async () => {
        const c = unique.get(k)!;
        if (breaker.open) { live.set(k, { ok: false, error: 'circuit open' }); return; }
        const ck = SearchCacheService.key('live', liveProvider.name, { k });
        try {
          const v = await withRetry(() => liveProvider.searchFlights(c));
          live.set(k, { ok: true, value: v, cached: false });
          breaker.success();
          // live fares go stale fast – short TTL
          await this.cache.set(ck, v, Math.min(60, config.providers.cacheTtlMin));
        } catch (e: any) {
          breaker.failure();
          if (!(e instanceof ProviderNotSupportedError)) this.log.warn(`live ${k} failed: ${e.message}`);
          live.set(k, { ok: false, error: e.message });
        }
        await stepDone();
      })));
      await publish(true);
    }

    // ---------- Stage 3 (optional): independent control check of each tracker's cheapest live result ----------
    const controlProvider = this.providers.control();
    const control = new Map<string, Result<ProviderOffer[]>>();
    const controlByTracker = new Map<string, SearchCriteria>();
    if (controlProvider) {
      for (const p of plans) {
        const cands = candidatesByTracker.get(p.trackerId)!;
        const liveOffers = cands.flatMap((c) => { const r = live.get(liveKey(c)); return r?.ok ? r.value : []; });
        const c = pickControlCriteria(p, cands, liveOffers);
        if (c) controlByTracker.set(p.trackerId, c);
      }
      const unique = new Map<string, SearchCriteria>();
      for (const c of controlByTracker.values()) unique.set(liveKey(c), c);
      if (unique.size) await startStage('control', unique.size);
      await Promise.all([...unique.entries()].map(([k, c]) => limit(async () => {
        const ck = SearchCacheService.key('live', controlProvider.name, { k });
        const cached = await this.cache.get<ProviderOffer[]>(ck);
        if (cached) { control.set(k, { ok: true, value: cached, cached: true }); cacheHits++; await stepDone(); return; }
        try {
          const v = await withRetry(() => controlProvider.searchFlights(c));
          control.set(k, { ok: true, value: v, cached: false });
          await this.cache.set(ck, v, Math.min(60, config.providers.cacheTtlMin));
        } catch (e: any) {
          // a control failure never degrades the run status – it is only reported
          this.log.warn(`control ${k} failed: ${e.message}`);
          control.set(k, { ok: false, error: e.message });
        }
        await stepDone();
      })));
    }

    // ---------- Per tracker: filter, store, analyse ----------
    const results: TrackerRunResult[] = [];
    for (const t of trackers) {
      const p = plans.find((x) => x.trackerId === t.id)!;
      const runId = runs.get(t.id)!;
      const cc = controlByTracker.get(t.id);
      const controlRun = cc && controlProvider ? { provider: controlProvider.name, criteria: cc, result: control.get(liveKey(cc)) } : undefined;
      try {
        results.push(await this.finalizeTracker(t, p, runId, indicative, live, candidatesByTracker.get(t.id)!, controlRun, quotaLimited.has(t.id)));
      } catch (e: any) {
        this.log.error(`tracker ${t.id} finalize failed: ${e.message}`);
        await this.prisma.searchRun.update({ where: { id: runId }, data: { status: 'FAILED', errorMessage: e.message, completedAt: new Date() } });
        results.push({ trackerId: t.id, searchRunId: runId, status: 'FAILED', analysis: null });
      }
    }

    if (batchId) {
      await this.prisma.dailyBatch.update({
        where: { id: batchId },
        data: {
          uniqueQueries: { increment: indicative.size + live.size + control.size },
          cacheHits: { increment: cacheHits },
        },
      });
    }
    return results;
  }

  /**
   * Uncached live keys that fit `allowance` checks: round-robin over the trackers' ranked
   * candidate lists, so every tracker gets its best candidate before anyone gets a second one.
   */
  private withinAllowance(lists: SearchCriteria[][], done: Map<string, unknown>, allowance: number): Set<string> {
    const out = new Set<string>();
    for (let i = 0; lists.some((l) => i < l.length); i++)
      for (const l of lists) {
        if (i >= l.length) continue;
        const k = liveKey(l[i]);
        if (!done.has(k) && (out.has(k) || out.size < allowance)) out.add(k);
      }
    return out;
  }

  private indicativeFor(p: TrackerSearchPlan, indicative: Map<string, Result<ProviderOffer[]>>): ProviderOffer[] {
    const out: ProviderOffer[] = [];
    for (const d of p.destinations)
      for (const c of p.combinations) {
        const r = indicative.get(indicativeKey(p, d, c));
        if (r?.ok) out.push(...r.value);
      }
    return out;
  }

  private async finalizeTracker(
    t: FlightTracker, p: TrackerSearchPlan, runId: string,
    indicative: Map<string, Result<ProviderOffer[]>>, live: Map<string, Result<ProviderOffer[]>>, candidates: SearchCriteria[],
    controlRun?: { provider: string; criteria: SearchCriteria; result?: Result<ProviderOffer[]> },
    quotaLimited = false,
  ): Promise<TrackerRunResult> {
    const offers: ProviderOffer[] = [];
    let indCalls = 0, indFailed = 0, liveFailed = 0;

    if (this.providers.indicative()) {
      for (const d of p.destinations)
        for (const c of p.combinations) {
          const r = indicative.get(indicativeKey(p, d, c));
          indCalls++;
          if (!r || !r.ok) indFailed++;
          else offers.push(...r.value);
        }
    }
    for (const c of candidates) {
      const r = live.get(liveKey(c));
      if (!r || !r.ok) liveFailed++;
      else offers.push(...r.value);
    }

    // Live stage is authoritative when it ran; indicative failures only degrade to PARTIAL.
    const useLive = candidates.length > 0;
    const callsTotal = indCalls + candidates.length;
    const callsFailed = indFailed + liveFailed;

    // Control source: report the price discrepancy, and keep its offers – if it found the same
    // trip cheaper, the user should see that price. Its failures don't affect the outcome.
    let controlCheck: ControlCheck | null = null;
    if (controlRun) {
      const r = controlRun.result ?? { ok: false as const, error: 'not executed' };
      controlCheck = compareControl(controlRun.provider, controlRun.criteria, offers, r);
      if (r.ok) offers.push(...r.value);
    }

    // rankingOnly offers (calendar prices without itinerary) only steer stage 2 – never stored
    const filtered = filterOffers(offers.filter((o) => !o.rankingOnly), p.maxStops, p.currency);
    const perRoute = [...cheapestPerRoute(filtered).values()].sort((a, b) => a.price - b.price);
    let outcome = useLive
      ? determineOutcome(candidates.length, liveFailed, perRoute.length)
      : determineOutcome(indCalls, indFailed, perRoute.length);
    if (outcome === 'SUCCESS' && indFailed > 0) outcome = 'PARTIAL';
    const now = new Date();

    // Store cheapest offer per route (airport + dates)
    if (perRoute.length) {
      await this.prisma.flightOffer.createMany({
        data: perRoute.map((o) => ({
          searchRunId: runId, provider: o.provider, providerOfferId: o.providerOfferId, routeKey: offerRouteKey(o),
          originAirport: o.origin, destinationAirport: o.destination,
          departureDate: parseIsoDate(o.departureDate), returnDate: parseIsoDate(o.returnDate),
          airline: o.airline, outboundStops: o.outboundStops, inboundStops: o.inboundStops,
          outboundDurationMin: o.outboundDurationMin, inboundDurationMin: o.inboundDurationMin,
          segments: (o.segments as unknown as Prisma.InputJsonValue) ?? undefined,
          price: o.price, currency: o.currency, originalPrice: o.originalPrice, originalCurrency: o.originalCurrency,
          priceLevel: o.priceInsight?.level, typicalPriceLow: o.priceInsight?.typicalLow, typicalPriceHigh: o.priceInsight?.typicalHigh,
          baggageIncluded: o.baggageIncluded, baggagePrice: o.baggagePrice,
          fareId: o.fareId, bookingUrl: o.bookingUrl, priceStatus: o.priceStatus,
          expiresAt: o.expiresAt ? new Date(o.expiresAt) : undefined, observedAt: new Date(o.observedAt),
        })),
      });
      await this.prisma.priceSnapshot.createMany({
        data: perRoute.map((o) => ({
          trackerId: t.id, searchRunId: runId, routeKey: offerRouteKey(o), destinationAirport: o.destination,
          departureDate: parseIsoDate(o.departureDate), returnDate: parseIsoDate(o.returnDate),
          price: o.price, currency: o.currency, priceStatus: o.priceStatus, recordedAt: now,
        })),
      });
    }

    // Prefer confirmed (LIVE) prices; fall back to INDICATIVE, flagged as such.
    const best = perRoute.find((o) => o.priceStatus === 'LIVE') ?? perRoute[0] ?? null;
    const current: CheapestPoint | null = best && {
      routeKey: offerRouteKey(best), destinationAirport: best.destination,
      departureDate: best.departureDate, returnDate: best.returnDate, price: best.price, priceStatus: best.priceStatus,
      priceLevel: best.priceInsight?.level ?? null,
      typicalRange: best.priceInsight?.typicalLow != null && best.priceInsight?.typicalHigh != null
        ? [best.priceInsight.typicalLow, best.priceInsight.typicalHigh] : null,
    };

    // compare only with runs of the current criteria (after an edit of currency/passengers/dates the
    // old prices measure something else – a "−70%" there would be a false trend and a false alert)
    const since = t.criteriaUpdatedAt;
    const analysis = analyzePrices({
      outcome, current,
      previousCheapest: await this.previousCheapest(t.id, runId, since),
      previousSameRoutePrice: current ? await this.previousSameRoute(t.id, runId, current.routeKey, since) : null,
      history: await this.history(t.id, runId, since),
      targetPrice: t.targetPrice != null ? Number(t.targetPrice) : null,
      significantChangePct: t.significantChangePct,
      now,
    });

    await this.prisma.searchRun.update({
      where: { id: runId },
      data: {
        status: outcome, completedAt: new Date(), combinationsChecked: callsTotal, providerCallsFailed: callsFailed,
        minPrice: current?.price, currency: p.currency,
        // googleHistory: Google's own recent prices for today's cheapest route – fills the chart of a new tracker
        analysis: { ...analysis, current, control: controlCheck, quotaLimited, googleHistory: best?.priceInsight?.history ?? null } as unknown as Prisma.InputJsonValue,
        errorMessage: outcome !== 'FAILED' ? null
          : quotaLimited ? "Today's free flight-API quota is used up – the check continues tomorrow"
          : 'Flight data provider unavailable',
      },
    });
    await this.prisma.flightTracker.update({ where: { id: t.id }, data: { lastSearchAt: now } });
    return { trackerId: t.id, searchRunId: runId, status: outcome, analysis };
  }

  private async previousCheapest(trackerId: string, runId: string, since: Date): Promise<CheapestPoint | null> {
    const prev = await this.prisma.searchRun.findFirst({
      where: { trackerId, id: { not: runId }, status: { in: ['SUCCESS', 'PARTIAL'] }, minPrice: { not: null }, startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
    });
    const a = prev?.analysis as any;
    return a?.current ?? null;
  }

  private async previousSameRoute(trackerId: string, runId: string, key: string, since: Date): Promise<number | null> {
    const s = await this.prisma.priceSnapshot.findFirst({
      where: { trackerId, routeKey: key, searchRunId: { not: runId }, recordedAt: { gte: since } },
      orderBy: { recordedAt: 'desc' },
    });
    return s ? Number(s.price) : null;
  }

  /** Daily minimum per previous run → used for 7d / 30d / historical minimum. */
  private async history(trackerId: string, runId: string, since: Date): Promise<HistoryPoint[]> {
    const runs = await this.prisma.searchRun.findMany({
      where: { trackerId, id: { not: runId }, status: { in: ['SUCCESS', 'PARTIAL'] }, minPrice: { not: null }, startedAt: { gte: since } },
      select: { minPrice: true, startedAt: true, analysis: true },
    });
    return runs.map((r) => ({
      price: Number(r.minPrice),
      recordedAt: r.startedAt,
      priceStatus: ((r.analysis as any)?.currentPriceStatus ?? 'LIVE') as 'LIVE' | 'INDICATIVE',
    }));
  }
}
