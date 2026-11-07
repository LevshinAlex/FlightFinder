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
import { buildDateCombinations } from './date-combinations';
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
      combinations: buildDateCombinations(
        { date: toIsoDate(t.departureDate), flexDays: t.departureFlexDays, mode: t.departureFlexMode },
        { date: toIsoDate(t.returnDate), flexDays: t.returnFlexDays, mode: t.returnFlexMode },
        today,
      ),
      adults: t.adults,
      cabinClass: t.cabinClass,
      currency: t.currency,
      maxStops: t.maxStops,
    };
  }

  async runForTrackers(trackerIds: string[], trigger: SearchTrigger, batchId?: string): Promise<TrackerRunResult[]> {
    const trackers = await this.prisma.flightTracker.findMany({ where: { id: { in: trackerIds }, status: 'ACTIVE' } });
    if (!trackers.length) return [];

    const runs = new Map<string, string>();
    for (const t of trackers) {
      // the scheduler pre-creates QUEUED runs for a batch – reuse them
      const queued = batchId
        ? await this.prisma.searchRun.findFirst({ where: { trackerId: t.id, batchId, status: 'QUEUED' } })
        : null;
      const run = queued
        ? await this.prisma.searchRun.update({ where: { id: queued.id }, data: { status: 'RUNNING', startedAt: new Date() } })
        : await this.prisma.searchRun.create({ data: { trackerId: t.id, trigger, batchId, status: 'RUNNING' } });
      runs.set(t.id, run.id);
    }

    const plans = trackers.map((t) => this.plan(t));
    const limit = createLimiter(config.providers.concurrency);
    let cacheHits = 0;

    // ---------- Stage 1: indicative ----------
    const indicativeProvider = this.providers.indicative();
    const indicative = new Map<string, Result<ProviderOffer[]>>();
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
      })));
    }

    // ---------- Stage 2: live check of promising candidates ----------
    const liveProvider = this.providers.live();
    const live = new Map<string, Result<ProviderOffer[]>>();
    const candidatesByTracker = new Map<string, SearchCriteria[]>();
    for (const p of plans) {
      const ind = this.indicativeFor(p, indicative);
      const candidates = liveProvider
        ? indicativeProvider
          ? selectLiveCandidates(p, ind, config.providers.liveCheckTopN)
          : allCriteria(p).slice(0, config.providers.liveCheckTopN * 3) // no stage 1: bounded brute force
        : [];
      candidatesByTracker.set(p.trackerId, candidates);
    }
    if (liveProvider) {
      const unique = new Map<string, SearchCriteria>();
      for (const list of candidatesByTracker.values()) for (const c of list) unique.set(liveKey(c), c);
      const breaker = new CircuitBreaker();
      await Promise.all([...unique.entries()].map(([k, c]) => limit(async () => {
        if (breaker.open) { live.set(k, { ok: false, error: 'circuit open' }); return; }
        const ck = SearchCacheService.key('live', liveProvider.name, { k });
        const cached = await this.cache.get<ProviderOffer[]>(ck);
        if (cached) { live.set(k, { ok: true, value: cached, cached: true }); cacheHits++; return; }
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
      })));
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
      await Promise.all([...unique.entries()].map(([k, c]) => limit(async () => {
        const ck = SearchCacheService.key('live', controlProvider.name, { k });
        const cached = await this.cache.get<ProviderOffer[]>(ck);
        if (cached) { control.set(k, { ok: true, value: cached, cached: true }); cacheHits++; return; }
        try {
          const v = await withRetry(() => controlProvider.searchFlights(c));
          control.set(k, { ok: true, value: v, cached: false });
          await this.cache.set(ck, v, Math.min(60, config.providers.cacheTtlMin));
        } catch (e: any) {
          // a control failure never degrades the run status – it is only reported
          this.log.warn(`control ${k} failed: ${e.message}`);
          control.set(k, { ok: false, error: e.message });
        }
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
        results.push(await this.finalizeTracker(t, p, runId, indicative, live, candidatesByTracker.get(t.id)!, controlRun));
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
          price: o.price, currency: o.currency, baggageIncluded: o.baggageIncluded, baggagePrice: o.baggagePrice,
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
    };

    const analysis = analyzePrices({
      outcome, current,
      previousCheapest: await this.previousCheapest(t.id, runId),
      previousSameRoutePrice: current ? await this.previousSameRoute(t.id, runId, current.routeKey) : null,
      history: await this.history(t.id, runId),
      targetPrice: t.targetPrice != null ? Number(t.targetPrice) : null,
      significantChangePct: t.significantChangePct,
      now,
    });

    await this.prisma.searchRun.update({
      where: { id: runId },
      data: {
        status: outcome, completedAt: new Date(), combinationsChecked: callsTotal, providerCallsFailed: callsFailed,
        minPrice: current?.price, currency: p.currency,
        analysis: { ...analysis, current, control: controlCheck } as unknown as Prisma.InputJsonValue,
        errorMessage: outcome === 'FAILED' ? 'Flight data provider unavailable' : null,
      },
    });
    await this.prisma.flightTracker.update({ where: { id: t.id }, data: { lastSearchAt: now } });
    return { trackerId: t.id, searchRunId: runId, status: outcome, analysis };
  }

  private async previousCheapest(trackerId: string, runId: string): Promise<CheapestPoint | null> {
    const prev = await this.prisma.searchRun.findFirst({
      where: { trackerId, id: { not: runId }, status: { in: ['SUCCESS', 'PARTIAL'] }, minPrice: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    const a = prev?.analysis as any;
    return a?.current ?? null;
  }

  private async previousSameRoute(trackerId: string, runId: string, key: string): Promise<number | null> {
    const s = await this.prisma.priceSnapshot.findFirst({
      where: { trackerId, routeKey: key, searchRunId: { not: runId } },
      orderBy: { recordedAt: 'desc' },
    });
    return s ? Number(s.price) : null;
  }

  /** Daily minimum per previous run → used for 7d / 30d / historical minimum. */
  private async history(trackerId: string, runId: string): Promise<HistoryPoint[]> {
    const runs = await this.prisma.searchRun.findMany({
      where: { trackerId, id: { not: runId }, status: { in: ['SUCCESS', 'PARTIAL'] }, minPrice: { not: null } },
      select: { minPrice: true, startedAt: true, analysis: true },
    });
    return runs.map((r) => ({
      price: Number(r.minPrice),
      recordedAt: r.startedAt,
      priceStatus: ((r.analysis as any)?.currentPriceStatus ?? 'LIVE') as 'LIVE' | 'INDICATIVE',
    }));
  }
}
