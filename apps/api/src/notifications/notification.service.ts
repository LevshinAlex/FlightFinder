import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationKind, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { AirportsService, flagEmoji } from '../airports/airports.service';
import { config } from '../common/config';
import { toIsoDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { EmailChannel } from './channels/email.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { buildDailyReport, buildPriceDropAlert, Locale, ReportItem } from './report-builder';

@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private airports: AirportsService,
    private email: EmailChannel,
    private whatsapp: WhatsAppChannel,
  ) {}

  private async item(trackerId: string, locale: Locale, since: Date | null, runId?: string): Promise<ReportItem> {
    const t = await this.prisma.flightTracker.findUniqueOrThrow({ where: { id: trackerId } });
    const country = this.airports.country(t.destinationCountry);
    const title = `${flagEmoji(country.code)} ${country.name[locale].toUpperCase()}${t.name ? ` · ${t.name}` : ''}`;
    const run = await this.prisma.searchRun.findFirst({
      where: runId ? { id: runId } : { trackerId, completedAt: { not: null }, ...(since ? { startedAt: { gte: since } } : {}) },
      orderBy: { startedAt: 'desc' },
    });
    const base: ReportItem = {
      trackerId, title, currency: t.currency, analysis: null, runStatus: 'NONE',
      detailsUrl: `${config.webUrl}/trackers/${t.id}`,
    };
    if (!run) return base;
    const analysis = run.analysis as any;
    const cur = analysis?.current;
    const offer = cur
      ? await this.prisma.flightOffer.findFirst({ where: { searchRunId: run.id, routeKey: cur.routeKey }, orderBy: { price: 'asc' } })
      : null;
    return {
      ...base,
      analysis,
      runStatus: run.status as ReportItem['runStatus'],
      bestCity: cur ? `${this.airports.airport(cur.destinationAirport)?.city[locale] ?? cur.destinationAirport} (${cur.destinationAirport})` : undefined,
      departureDate: cur?.departureDate,
      returnDate: cur?.returnDate,
      stopsOut: offer?.outboundStops,
      stopsIn: offer?.inboundStops,
      airline: offer?.airline ?? undefined,
      bookingUrl: offer?.bookingUrl ?? undefined,
      checkedAt: offer?.observedAt ?? run.completedAt ?? undefined,
    };
  }

  private async log_(userId: string, channel: NotificationChannel, kind: NotificationKind, status: 'SENT' | 'FAILED' | 'SKIPPED', dedupeKey: string | null, providerMessageId?: string, error?: string) {
    try {
      await this.prisma.notificationLog.create({ data: { userId, channel, kind, status, dedupeKey, providerMessageId, error } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }

  private async alreadySent(dedupeKey: string) {
    return !!(await this.prisma.notificationLog.findUnique({ where: { dedupeKey } }));
  }

  /** One summary for ALL active trackers of the user (spec 8.1, test #6). Paused trackers are excluded (test #7). */
  async sendDailySummary(userId: string, reportDate: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { preferences: true, trackers: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } },
    });
    const prefs = user.preferences;
    const locale = (user.locale === 'en' ? 'en' : 'ru') as Locale;
    const tz = prefs?.timezone ?? user.timezone;
    const dayStart = DateTime.fromISO(reportDate, { zone: tz }).startOf('day').toJSDate();
    const active = user.trackers.filter((t) => toIsoDate(t.returnDate) >= reportDate);
    const items = await Promise.all(active.map((t) => this.item(t.id, locale, dayStart)));
    if (!items.length) return { skipped: 'no active trackers' };
    const report = buildDailyReport(items, reportDate, locale);
    const keyBase = `DAILY_SUMMARY:${userId}:${reportDate}`;
    let sentAny = false;

    if (prefs?.emailEnabled !== false) {
      const key = `${keyBase}:EMAIL`;
      if (!(await this.alreadySent(key))) {
        try {
          const id = await this.email.send({ to: user.email, subject: report.subject, html: report.html, text: report.text });
          await this.log_(userId, 'EMAIL', 'DAILY_SUMMARY', 'SENT', key, id);
          sentAny = true;
        } catch (e: any) {
          await this.log_(userId, 'EMAIL', 'DAILY_SUMMARY', 'FAILED', null, undefined, e.message);
          throw e; // let BullMQ retry
        }
      }
    }
    if (prefs?.whatsappEnabled && user.phone && user.whatsappConsentAt && this.whatsapp.enabled) {
      const key = `${keyBase}:WHATSAPP`;
      if (!(await this.alreadySent(key))) {
        try {
          const id = await this.whatsapp.sendSummary(user.phone, `${report.whatsapp}\n${config.webUrl}/dashboard`);
          await this.log_(userId, 'WHATSAPP', 'DAILY_SUMMARY', 'SENT', key, id);
          sentAny = true;
        } catch (e: any) {
          this.log.warn(`WhatsApp failed for ${userId}: ${e.message}`);
          await this.log_(userId, 'WHATSAPP', 'DAILY_SUMMARY', 'FAILED', null, undefined, e.message);
        }
      }
    }
    if (!sentAny && !(await this.alreadySent(`${keyBase}:EMAIL`))) {
      await this.log_(userId, 'EMAIL', 'DAILY_SUMMARY', 'SKIPPED', `${keyBase}:NONE`);
    }
    return { items: items.length };
  }

  async sendPriceDrop(userId: string, trackerId: string, searchRunId: string, reportDate: string) {
    const key = `PRICE_DROP:${trackerId}:${reportDate}`;
    if (await this.alreadySent(key)) return;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { preferences: true } });
    const tracker = await this.prisma.flightTracker.findFirst({ where: { id: trackerId, userId, status: 'ACTIVE' } });
    if (!tracker || user.preferences?.emailEnabled === false) return;
    const locale = (user.locale === 'en' ? 'en' : 'ru') as Locale;
    const msg = buildPriceDropAlert(await this.item(trackerId, locale, null, searchRunId), locale);
    const id = await this.email.send({ to: user.email, ...msg });
    await this.log_(userId, 'EMAIL', 'PRICE_DROP', 'SENT', key, id);
  }

  async sendTest(userId: string, channel: 'EMAIL' | 'WHATSAPP') {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { trackers: { where: { status: 'ACTIVE' } } } });
    const locale = (user.locale === 'en' ? 'en' : 'ru') as Locale;
    const items = await Promise.all(user.trackers.map((t) => this.item(t.id, locale, null)));
    const report = buildDailyReport(items, toIsoDate(new Date()), locale);
    if (channel === 'WHATSAPP') {
      if (!user.phone || !user.whatsappConsentAt) throw new Error('Phone number and WhatsApp consent are required');
      const id = await this.whatsapp.sendSummary(user.phone, report.whatsapp);
      await this.log_(userId, 'WHATSAPP', 'TEST', 'SENT', null, id);
      return { ok: true };
    }
    const id = await this.email.send({ to: user.email, subject: `[TEST] ${report.subject}`, html: report.html, text: report.text });
    await this.log_(userId, 'EMAIL', 'TEST', 'SENT', null, id);
    return { ok: true };
  }
}
