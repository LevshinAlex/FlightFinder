import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_QUEUE, NotifyJob } from '../search/queues';
import { SearchQueueService } from '../search/search-queue.service';

/** Search starts this many minutes before the user's report time (spec 4.1). */
export const SEARCH_LEAD_MINUTES = 60;
/** If searches are still running this long after report time, send the report anyway. */
export const REPORT_GRACE_MINUTES = 45;

/**
 * Runs inside the worker process every 5 minutes:
 *  - starts the daily search batch for users whose report time is approaching
 *  - sends the daily summary once their searches have finished
 * Idempotent: safe to run repeatedly / on several workers.
 */
@Injectable()
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private search: SearchQueueService,
    @InjectQueue(NOTIFY_QUEUE) private notify: Queue<NotifyJob>,
  ) {}

  @Cron('*/5 * * * *')
  async tick(now = DateTime.utc()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.scheduleSearches(now);
      await this.scheduleReports(now);
    } catch (e: any) {
      this.log.error(`scheduler tick failed: ${e.message}`, e.stack);
    } finally {
      this.running = false;
    }
  }

  private localTimes(tz: string, preferredTime: string, now: DateTime) {
    const local = now.setZone(tz);
    const [h, m] = preferredTime.split(':').map(Number);
    const report = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
    return { local, report, searchAt: report.minus({ minutes: SEARCH_LEAD_MINUTES }), dayStart: local.startOf('day') };
  }

  async scheduleSearches(now: DateTime) {
    const users = await this.prisma.user.findMany({
      where: { trackers: { some: { status: 'ACTIVE' } } },
      include: { preferences: true, trackers: { where: { status: 'ACTIVE' }, select: { id: true, returnDate: true } } },
    });
    const due: string[] = [];
    for (const u of users) {
      const p = u.preferences ?? { timezone: u.timezone, preferredTime: '07:00' };
      const { local, searchAt, dayStart } = this.localTimes(p.timezone, p.preferredTime, now);
      if (local < searchAt) continue;
      const todayIso = local.toISODate()!;
      // skip trips that are already over
      const trackerIds = u.trackers.filter((t) => t.returnDate.toISOString().slice(0, 10) >= todayIso).map((t) => t.id);
      if (!trackerIds.length) continue;
      const done = await this.prisma.searchRun.findMany({
        where: { trackerId: { in: trackerIds }, trigger: 'SCHEDULED', startedAt: { gte: dayStart.toJSDate() } },
        select: { trackerId: true },
      });
      const doneIds = new Set(done.map((d) => d.trackerId));
      due.push(...trackerIds.filter((id) => !doneIds.has(id)));
    }
    if (!due.length) return;

    const batch = await this.prisma.dailyBatch.create({ data: { trackersTotal: due.length } });
    // Mark runs as queued immediately so the next tick does not schedule them again
    await this.prisma.searchRun.createMany({ data: due.map((trackerId) => ({ trackerId, trigger: 'SCHEDULED' as const, status: 'QUEUED' as const, batchId: batch.id })) });
    await this.search.enqueueBatch(due, batch.id);
    this.log.log(`daily batch ${batch.id}: ${due.length} trackers queued`);
  }

  async scheduleReports(now: DateTime) {
    const users = await this.prisma.user.findMany({
      where: { trackers: { some: { status: 'ACTIVE' } }, preferences: { dailySummaryEnabled: true } },
      include: { preferences: true, trackers: { where: { status: 'ACTIVE' }, select: { id: true } } },
    });
    for (const u of users) {
      const p = u.preferences!;
      const { local, report, dayStart } = this.localTimes(p.timezone, p.preferredTime, now);
      if (local < report) continue;
      const reportDate = local.toISODate()!;
      const already = await this.prisma.notificationLog.findFirst({
        where: { userId: u.id, kind: 'DAILY_SUMMARY', dedupeKey: { startsWith: `DAILY_SUMMARY:${u.id}:${reportDate}` } },
      });
      if (already) continue;
      const pending = await this.prisma.searchRun.count({
        where: { trackerId: { in: u.trackers.map((t) => t.id) }, trigger: 'SCHEDULED', startedAt: { gte: dayStart.toJSDate() }, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (pending > 0 && local < report.plus({ minutes: REPORT_GRACE_MINUTES })) continue;
      await this.notify.add('daily-summary', { type: 'daily-summary', userId: u.id, reportDate }, {
        jobId: `summary-${u.id}-${reportDate}`, attempts: 3, backoff: { type: 'exponential', delay: 60000 },
      });
    }
  }
}
