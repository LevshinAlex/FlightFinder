import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { FlightTracker, Prisma } from '@prisma/client';
import { AirportsService, flagEmoji } from '../airports/airports.service';
import { config } from '../common/config';
import { parseIsoDate, toIsoDate } from '../common/dates';
import { fx, round2 } from '../common/fx';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderOffer } from '../providers/flight-provider.interface';
import { buildDateCombinations, hasSearchableDates } from '../search/date-combinations';
import { progressKey, RunProgress } from '../search/run-progress';
import { activeRunWhere } from '../search/run-state';
import { SearchCacheService } from '../search/search-cache.service';
import { SearchQueueService } from '../search/search-queue.service';
import { TrackerDto } from './tracker.dto';

/** Editing any of these changes what the tracked price means – it starts a new comparison epoch (criteriaUpdatedAt). */
const PRICE_CRITERIA = [
  'originAirport', 'destinationCountry', 'destinationAirports', 'departureDate', 'departureFlexDays', 'departureFlexMode',
  'returnDate', 'returnFlexDays', 'returnFlexMode', 'maxStops', 'adults', 'cabinClass', 'currency',
] as const;
const norm = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].sort() : v);

@Injectable()
export class TrackersService implements OnApplicationBootstrap {
  private readonly log = new Logger(TrackersService.name);
  constructor(
    private prisma: PrismaService, private airports: AirportsService, private queue: SearchQueueService, private cache: SearchCacheService,
  ) {}

  /** Runs in the background on API start – never delays the health check. */
  onApplicationBootstrap() {
    void this.convertToBaseCurrency().catch((e) => this.log.warn(`currency conversion of trackers failed: ${e.message}`));
  }

  /**
   * Trackers from before all prices moved to the base currency (USD): the target price is converted at
   * today's rate and a new comparison epoch starts (old prices are in other units). Idempotent; a tracker
   * whose rate is unavailable keeps its old currency until the next start – the engine converts
   * to whatever currency a tracker has, so it keeps working meanwhile.
   */
  async convertToBaseCurrency() {
    const base = config.baseCurrency;
    const legacy = await this.prisma.flightTracker.findMany({ where: { currency: { not: base } } });
    for (const t of legacy) {
      const rate = await fx.rate(t.currency, base);
      await this.prisma.flightTracker.update({
        where: { id: t.id },
        data: { currency: base, criteriaUpdatedAt: new Date(), targetPrice: t.targetPrice != null ? round2(Number(t.targetPrice) * rate) : null },
      });
    }
    if (legacy.length) this.log.log(`${legacy.length} tracker(s) converted to ${base}`);
  }

  /** Every query is scoped by userId – a foreign id behaves exactly like a missing one (test #9). */
  async getOwned(userId: string, id: string) {
    const t = await this.prisma.flightTracker.findFirst({ where: { id, userId } });
    if (!t) throw new NotFoundException('Tracker not found');
    return t;
  }

  private validate(dto: TrackerDto) {
    const today = toIsoDate(new Date());
    if (dto.departureDate < today) throw new BadRequestException('Departure date is in the past');
    if (dto.returnDate <= dto.departureDate) throw new BadRequestException('Return date must be after departure date');
    const country = this.airports.country(dto.destinationCountry);
    const origin = dto.originAirport ?? 'TLV';
    if (!this.airports.airport(origin)) throw new BadRequestException(`Unknown origin airport ${origin}`);
    const dest = (dto.destinationAirports ?? []).map((a) => a.toUpperCase());
    const valid = country.airports.map((a) => a.iata);
    const bad = dest.filter((d) => !valid.includes(d));
    if (bad.length) throw new BadRequestException(`Airports not in ${country.code}: ${bad.join(', ')}`);
    const combos = buildDateCombinations(
      { date: dto.departureDate, flexDays: dto.departureFlexDays ?? 2, mode: dto.departureFlexMode ?? 'PLUS' },
      { date: dto.returnDate, flexDays: dto.returnFlexDays ?? 2, mode: dto.returnFlexMode ?? 'MINUS' },
      today,
    );
    if (!combos.length) throw new BadRequestException('No valid date combinations');
    return { origin, dest };
  }

  private toData(dto: TrackerDto, origin: string, dest: string[]) {
    return {
      name: dto.name || null,
      originCountry: (dto.originCountry ?? this.airports.airport(origin)!.country).toUpperCase(),
      originAirport: origin.toUpperCase(),
      destinationCountry: dto.destinationCountry.toUpperCase(),
      destinationAirports: dest,
      departureDate: parseIsoDate(dto.departureDate),
      returnDate: parseIsoDate(dto.returnDate),
      departureFlexDays: dto.departureFlexDays ?? 2,
      departureFlexMode: dto.departureFlexMode ?? 'PLUS',
      returnFlexDays: dto.returnFlexDays ?? 2,
      returnFlexMode: dto.returnFlexMode ?? 'MINUS',
      maxStops: dto.maxStops ?? 1,
      adults: dto.adults ?? 1,
      cabinClass: dto.cabinClass ?? 'ECONOMY',
      currency: config.baseCurrency, // all prices are in one currency (USD); a quote in another one is converted
      targetPrice: dto.targetPrice ?? null,
      significantChangePct: dto.significantChangePct ?? 2,
    } satisfies Omit<Prisma.FlightTrackerUncheckedCreateInput, 'userId'>;
  }

  async list(userId: string) {
    const trackers = await this.prisma.flightTracker.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return Promise.all(trackers.map((t) => this.summary(t)));
  }

  /** A search is queued or running (stale runs without a worker don't count – see run-state.ts). */
  private async inProgress(trackerId: string, onlyQueued = false) {
    const n = await this.prisma.searchRun.count({ where: { AND: [activeRunWhere(), { trackerId }, onlyQueued ? { status: 'QUEUED' } : {}] } });
    return n > 0;
  }

  private async summary(t: FlightTracker) {
    const [lastRun, lastOk, inProgress] = await Promise.all([
      this.prisma.searchRun.findFirst({ where: { trackerId: t.id }, orderBy: { startedAt: 'desc' } }),
      // prices from before the last criteria edit are in other units (currency, passengers, …)
      this.prisma.searchRun.findFirst({ where: { trackerId: t.id, status: { in: ['SUCCESS', 'PARTIAL'] }, startedAt: { gte: t.criteriaUpdatedAt } }, orderBy: { startedAt: 'desc' } }),
      this.inProgress(t.id),
    ]);
    const a = lastOk?.analysis as any;
    const country = this.airports.country(t.destinationCountry);
    return {
      ...t,
      targetPrice: t.targetPrice != null ? Number(t.targetPrice) : null,
      departureDate: toIsoDate(t.departureDate),
      returnDate: toIsoDate(t.returnDate),
      country: { code: country.code, name: country.name, flag: flagEmoji(country.code) },
      lastRun: lastRun && { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, completedAt: lastRun.completedAt },
      inProgress,
      /** trip dates passed: nothing left to search (never scheduled, no manual search) */
      expired: !hasSearchableDates(t),
      minPrice: a?.currentMinPrice ?? null,
      priceStatus: a?.currentPriceStatus ?? null,
      priceChangePct: a?.priceChangePct ?? null,
      trendStatus: a?.status ?? null,
      lastSuccessfulCheckAt: lastOk?.completedAt ?? null,
    };
  }

  async create(userId: string, dto: TrackerDto) {
    const { origin, dest } = this.validate(dto);
    const t = await this.prisma.flightTracker.create({ data: { userId, ...this.toData(dto, origin, dest) } });
    await this.queue.enqueueTracker(t.id, 'INITIAL'); // first check right away (spec 7, screen 3)
    return this.summary(t);
  }

  async get(userId: string, id: string) {
    return this.summary(await this.getOwned(userId, id));
  }

  async update(userId: string, id: string, dto: TrackerDto) {
    const before = await this.getOwned(userId, id);
    const { origin, dest } = this.validate(dto);
    const data = this.toData(dto, origin, dest);
    const criteriaChanged = PRICE_CRITERIA.some((k) => norm(before[k]) !== norm(data[k]));
    const t = await this.prisma.flightTracker.update({ where: { id }, data: { ...data, ...(criteriaChanged ? { criteriaUpdatedAt: new Date() } : {}) } });
    // a run that is still QUEUED reads the tracker when it starts – it will already use the new criteria
    if (t.status === 'ACTIVE' && !(await this.inProgress(id, true))) await this.queue.enqueueTracker(t.id, 'MANUAL');
    return this.summary(t);
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.prisma.flightTracker.delete({ where: { id } });
    return { ok: true };
  }

  async setStatus(userId: string, id: string, status: 'ACTIVE' | 'PAUSED') {
    await this.getOwned(userId, id);
    return this.summary(await this.prisma.flightTracker.update({ where: { id }, data: { status } }));
  }

  async manualSearch(userId: string, id: string) {
    const t = await this.getOwned(userId, id);
    if (t.status !== 'ACTIVE') throw new BadRequestException('Tracker is paused');
    if (!hasSearchableDates(t)) throw new BadRequestException('The trip dates have passed');
    if (await this.inProgress(id)) throw new HttpException('A search is already in progress', HttpStatus.TOO_MANY_REQUESTS);
    const cooldownMs = config.manualSearchCooldownMin * 60_000;
    if (t.lastSearchAt && Date.now() - t.lastSearchAt.getTime() < cooldownMs) {
      const wait = Math.ceil((cooldownMs - (Date.now() - t.lastSearchAt.getTime())) / 60000);
      throw new HttpException(`Please wait ${wait} min before the next manual search`, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.queue.enqueueTracker(id, 'MANUAL');
    return { queued: true };
  }

  /**
   * Cheapest flights of the latest completed run – and, while a search runs, what it has found so far
   * (`progress`, published by the worker: see run-progress.ts), so the page fills in without waiting for the end.
   */
  async results(userId: string, id: string) {
    const t = await this.getOwned(userId, id);
    const run = await this.prisma.searchRun.findFirst({ where: { trackerId: id, completedAt: { not: null } }, orderBy: { startedAt: 'desc' } });
    const inProgress = await this.inProgress(id);
    const live = inProgress ? await this.runProgress(id) : null;
    const progress = live && {
      stage: live.stage, done: live.done, total: live.total, updatedAt: live.updatedAt,
      offers: live.offers.map((o, i) => this.presentPartialOffer(o, i)),
    };
    const offers = run ? await this.prisma.flightOffer.findMany({ where: { searchRunId: run.id }, orderBy: { price: 'asc' }, take: 50 }) : [];
    // city names of the itinerary airports (layovers) for the UI; unknown airports stay as IATA codes
    const places: Record<string, { en: string; ru: string }> = {};
    for (const o of [...offers, ...(live?.offers ?? [])]) {
      const segs = o.segments as { outbound?: { from: string; to: string }[]; inbound?: { from: string; to: string }[] } | null | undefined;
      for (const x of [...(segs?.outbound ?? []), ...(segs?.inbound ?? [])])
        for (const code of [x.from, x.to]) {
          const ap = code && !places[code] ? this.airports.airport(code) : null;
          if (ap) places[code] = ap.city;
        }
    }
    if (!run) return { run: null, offers: [], inProgress, progress, places, currency: t.currency };
    return {
      inProgress,
      progress,
      run: { id: run.id, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, combinationsChecked: run.combinationsChecked, providerCallsFailed: run.providerCallsFailed, errorMessage: run.errorMessage },
      currency: t.currency,
      places,
      offers: offers.map((o) => {
        const ap = this.airports.airport(o.destinationAirport);
        return {
          ...o,
          price: Number(o.price),
          originalPrice: o.originalPrice != null ? Number(o.originalPrice) : null,
          typicalPriceLow: o.typicalPriceLow != null ? Number(o.typicalPriceLow) : null,
          typicalPriceHigh: o.typicalPriceHigh != null ? Number(o.typicalPriceHigh) : null,
          baggagePrice: o.baggagePrice != null ? Number(o.baggagePrice) : null,
          departureDate: toIsoDate(o.departureDate),
          returnDate: toIsoDate(o.returnDate),
          destinationCity: ap?.city ?? null,
          expired: o.expiresAt ? o.expiresAt < new Date() : false,
        };
      }),
    };
  }

  /** What the tracker's running search has found so far (null: not started yet / no shared cache). */
  private async runProgress(trackerId: string): Promise<RunProgress | null> {
    const run = await this.prisma.searchRun.findFirst({
      where: { AND: [activeRunWhere(), { trackerId, status: 'RUNNING' }] }, orderBy: { startedAt: 'desc' }, select: { id: true },
    });
    return run ? this.cache.get<RunProgress>(progressKey(run.id)) : null;
  }

  /** A not-yet-stored offer in the shape of a stored one (the page renders both with the same table). */
  private presentPartialOffer(o: ProviderOffer, i: number) {
    return {
      id: `partial-${i}-${o.provider}-${o.destination}-${o.departureDate}-${o.returnDate}`,
      provider: o.provider, originAirport: o.origin, destinationAirport: o.destination,
      departureDate: o.departureDate, returnDate: o.returnDate, airline: o.airline ?? null,
      outboundStops: o.outboundStops, inboundStops: o.inboundStops,
      outboundDurationMin: o.outboundDurationMin ?? null, inboundDurationMin: o.inboundDurationMin ?? null,
      segments: o.segments ?? null, price: o.price, currency: o.currency,
      originalPrice: o.originalPrice ?? null, originalCurrency: o.originalCurrency ?? null,
      priceLevel: o.priceInsight?.level ?? null, typicalPriceLow: o.priceInsight?.typicalLow ?? null, typicalPriceHigh: o.priceInsight?.typicalHigh ?? null,
      baggageIncluded: o.baggageIncluded ?? null, baggagePrice: o.baggagePrice ?? null,
      bookingUrl: o.bookingUrl ?? null, priceStatus: o.priceStatus, observedAt: o.observedAt,
      destinationCity: this.airports.airport(o.destination)?.city ?? null,
      expired: o.expiresAt ? new Date(o.expiresAt) < new Date() : false,
    };
  }

  /** Price history for the chart + daily search history list. range: 7 | 30 | all */
  async history(userId: string, id: string, range: string) {
    const t = await this.getOwned(userId, id);
    const days = range === '7' ? 7 : range === '30' ? 30 : null;
    const since = days ? new Date(Date.now() - days * 86400e3) : undefined;
    const runs = await this.prisma.searchRun.findMany({
      where: { trackerId: id, completedAt: { not: null }, ...(since ? { startedAt: { gte: since } } : {}) },
      orderBy: { startedAt: 'asc' },
    });
    // the chart shows one comparable series: prices since the last criteria edit
    const current = runs.filter((r) => r.startedAt >= t.criteriaUpdatedAt);
    // Google's own recent prices for the latest cheapest route: a new tracker has a chart from day one
    const g = [...current].reverse().map((r) => (r.analysis as any)?.googleHistory).find((h) => Array.isArray(h) && h.length) as [number, number][] | undefined;
    return {
      points: current
        .filter((r) => r.minPrice != null && (r.status === 'SUCCESS' || r.status === 'PARTIAL'))
        .map((r) => {
          const a = r.analysis as any;
          return { date: r.startedAt, price: Number(r.minPrice), destination: a?.current?.destinationAirport ?? null, priceStatus: a?.currentPriceStatus ?? null };
        }),
      googlePoints: (g ?? []).filter(([ts]) => !since || ts >= since.getTime()).map(([ts, price]) => ({ date: new Date(ts), price })),
      runs: [...runs].reverse().map((r) => ({
        id: r.id, startedAt: r.startedAt, completedAt: r.completedAt, status: r.status, trigger: r.trigger,
        minPrice: r.minPrice != null ? Number(r.minPrice) : null, currency: r.currency ?? t.currency, combinationsChecked: r.combinationsChecked,
        priceChangePct: (r.analysis as any)?.priceChangePct ?? null, errorMessage: r.errorMessage,
      })),
    };
  }

  async trends(userId: string, id: string) {
    const t = await this.getOwned(userId, id);
    const run = await this.prisma.searchRun.findFirst({
      where: { trackerId: id, completedAt: { not: null }, startedAt: { gte: t.criteriaUpdatedAt } }, orderBy: { startedAt: 'desc' },
    });
    return { runStatus: run?.status ?? null, checkedAt: run?.completedAt ?? null, analysis: run?.analysis ?? null };
  }
}
