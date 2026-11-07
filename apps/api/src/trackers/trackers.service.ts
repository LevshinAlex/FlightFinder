import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AirportsService, flagEmoji } from '../airports/airports.service';
import { config } from '../common/config';
import { parseIsoDate, toIsoDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { buildDateCombinations } from '../search/date-combinations';
import { SearchQueueService } from '../search/search-queue.service';
import { TrackerDto } from './tracker.dto';

@Injectable()
export class TrackersService {
  constructor(private prisma: PrismaService, private airports: AirportsService, private queue: SearchQueueService) {}

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
      currency: dto.currency ?? 'ILS',
      targetPrice: dto.targetPrice ?? null,
      significantChangePct: dto.significantChangePct ?? 2,
    } satisfies Omit<Prisma.FlightTrackerUncheckedCreateInput, 'userId'>;
  }

  async list(userId: string) {
    const trackers = await this.prisma.flightTracker.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return Promise.all(trackers.map((t) => this.summary(t)));
  }

  private async summary(t: Awaited<ReturnType<TrackersService['getOwned']>>) {
    const [lastRun, lastOk] = await Promise.all([
      this.prisma.searchRun.findFirst({ where: { trackerId: t.id }, orderBy: { startedAt: 'desc' } }),
      this.prisma.searchRun.findFirst({ where: { trackerId: t.id, status: { in: ['SUCCESS', 'PARTIAL'] } }, orderBy: { startedAt: 'desc' } }),
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
    await this.getOwned(userId, id);
    const { origin, dest } = this.validate(dto);
    const t = await this.prisma.flightTracker.update({ where: { id }, data: this.toData(dto, origin, dest) });
    if (t.status === 'ACTIVE') await this.queue.enqueueTracker(t.id, 'MANUAL');
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
    const running = await this.prisma.searchRun.count({ where: { trackerId: id, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (running) throw new HttpException('A search is already in progress', HttpStatus.TOO_MANY_REQUESTS);
    const cooldownMs = config.manualSearchCooldownMin * 60_000;
    if (t.lastSearchAt && Date.now() - t.lastSearchAt.getTime() < cooldownMs) {
      const wait = Math.ceil((cooldownMs - (Date.now() - t.lastSearchAt.getTime())) / 60000);
      throw new HttpException(`Please wait ${wait} min before the next manual search`, HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.queue.enqueueTracker(id, 'MANUAL');
    return { queued: true };
  }

  /** Cheapest flights of the latest completed run. */
  async results(userId: string, id: string) {
    const t = await this.getOwned(userId, id);
    const run = await this.prisma.searchRun.findFirst({ where: { trackerId: id, completedAt: { not: null } }, orderBy: { startedAt: 'desc' } });
    const inProgress = await this.prisma.searchRun.count({ where: { trackerId: id, status: { in: ['QUEUED', 'RUNNING'] } } });
    if (!run) return { run: null, offers: [], inProgress: inProgress > 0 };
    const offers = await this.prisma.flightOffer.findMany({ where: { searchRunId: run.id }, orderBy: { price: 'asc' }, take: 50 });
    // city names of the itinerary airports (layovers) for the UI; unknown airports stay as IATA codes
    const places: Record<string, { en: string; ru: string }> = {};
    for (const o of offers) {
      const segs = o.segments as { outbound?: { from: string; to: string }[]; inbound?: { from: string; to: string }[] } | null;
      for (const x of [...(segs?.outbound ?? []), ...(segs?.inbound ?? [])])
        for (const code of [x.from, x.to]) {
          const ap = code && !places[code] ? this.airports.airport(code) : null;
          if (ap) places[code] = ap.city;
        }
    }
    return {
      inProgress: inProgress > 0,
      run: { id: run.id, status: run.status, startedAt: run.startedAt, completedAt: run.completedAt, combinationsChecked: run.combinationsChecked, providerCallsFailed: run.providerCallsFailed, errorMessage: run.errorMessage },
      currency: t.currency,
      places,
      offers: offers.map((o) => {
        const ap = this.airports.airport(o.destinationAirport);
        return {
          ...o,
          price: Number(o.price),
          baggagePrice: o.baggagePrice != null ? Number(o.baggagePrice) : null,
          departureDate: toIsoDate(o.departureDate),
          returnDate: toIsoDate(o.returnDate),
          destinationCity: ap?.city ?? null,
          expired: o.expiresAt ? o.expiresAt < new Date() : false,
        };
      }),
    };
  }

  /** Price history for the chart + daily search history list. range: 7 | 30 | all */
  async history(userId: string, id: string, range: string) {
    await this.getOwned(userId, id);
    const days = range === '7' ? 7 : range === '30' ? 30 : null;
    const since = days ? new Date(Date.now() - days * 86400e3) : undefined;
    const runs = await this.prisma.searchRun.findMany({
      where: { trackerId: id, completedAt: { not: null }, ...(since ? { startedAt: { gte: since } } : {}) },
      orderBy: { startedAt: 'asc' },
    });
    return {
      points: runs
        .filter((r) => r.minPrice != null && (r.status === 'SUCCESS' || r.status === 'PARTIAL'))
        .map((r) => {
          const a = r.analysis as any;
          return { date: r.startedAt, price: Number(r.minPrice), destination: a?.current?.destinationAirport ?? null, priceStatus: a?.currentPriceStatus ?? null };
        }),
      runs: runs.reverse().map((r) => ({
        id: r.id, startedAt: r.startedAt, completedAt: r.completedAt, status: r.status, trigger: r.trigger,
        minPrice: r.minPrice != null ? Number(r.minPrice) : null, combinationsChecked: r.combinationsChecked,
        priceChangePct: (r.analysis as any)?.priceChangePct ?? null, errorMessage: r.errorMessage,
      })),
    };
  }

  async trends(userId: string, id: string) {
    await this.getOwned(userId, id);
    const run = await this.prisma.searchRun.findFirst({ where: { trackerId: id, completedAt: { not: null } }, orderBy: { startedAt: 'desc' } });
    return { runStatus: run?.status ?? null, checkedAt: run?.completedAt ?? null, analysis: run?.analysis ?? null };
  }
}
