import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { shouldSendPriceAlert } from '../analysis/price-analysis';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_QUEUE, NotifyJob, SEARCH_QUEUE, SearchJob } from './queues';
import { failUnfinishedRuns } from './run-state';
import { SearchEngineService } from './search-engine.service';

@Processor(SEARCH_QUEUE, { concurrency: 2, lockDuration: 10 * 60 * 1000 })
export class SearchProcessor extends WorkerHost {
  private readonly log = new Logger(SearchProcessor.name);

  constructor(
    private engine: SearchEngineService,
    private prisma: PrismaService,
    @InjectQueue(NOTIFY_QUEUE) private notify: Queue<NotifyJob>,
  ) {
    super();
  }

  async process(job: Job<SearchJob>) {
    try {
      return await this.run(job);
    } catch (e: any) {
      // last attempt: settle the runs this job still owns (e.g. QUEUED ones it never reached)
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await this.giveUp(job.data, e);
      throw e;
    }
  }

  private async run(job: Job<SearchJob>) {
    const started = Date.now();
    const d = job.data;
    if (d.type === 'tracker') {
      const r = await this.engine.runForTrackers([d.trackerId], d.trigger, { runId: d.runId });
      this.log.log(`tracker ${d.trackerId}: ${r[0]?.status ?? 'skipped (paused/deleted/dates passed)'} in ${Date.now() - started}ms`);
      return r;
    }

    // the engine also drops placeholder runs of trackers paused/deleted after queueing (test #7)
    const results = await this.engine.runForTrackers(d.trackerIds, 'SCHEDULED', { batchId: d.batchId });
    const ok = results.filter((r) => r.status !== 'FAILED').length;
    await this.prisma.dailyBatch.update({
      where: { id: d.batchId },
      data: { completedAt: new Date(), trackersSucceeded: ok, trackersFailed: results.length - ok },
    });
    this.log.log(`batch ${d.batchId}: ${ok}/${results.length} ok in ${Date.now() - started}ms`);

    // Extra alerts on significant drop / target reached (sent during the morning check, spec 8.3)
    for (const r of results) {
      const a = r.analysis;
      if (!a || (a.outcome !== 'SUCCESS' && a.outcome !== 'PARTIAL')) continue;
      const tracker = await this.prisma.flightTracker.findUnique({ where: { id: r.trackerId }, include: { user: { include: { preferences: true } } } });
      const prefs = tracker?.user.preferences;
      if (!tracker || !prefs?.priceDropAlertEnabled) continue;
      if (shouldSendPriceAlert(a, prefs.priceDropAlertPct, tracker.targetPrice != null ? Number(tracker.targetPrice) : null)) {
        const reportDate = DateTime.now().setZone(prefs.timezone).toISODate()!;
        await this.notify.add('price-drop', { type: 'price-drop', userId: tracker.userId, trackerId: tracker.id, searchRunId: r.searchRunId, reportDate }, {
          jobId: `drop-${tracker.id}-${reportDate}`, attempts: 3, backoff: { type: 'exponential', delay: 60000 },
        });
      }
    }
    return { ok, total: results.length };
  }

  private async giveUp(d: SearchJob, e: Error) {
    try {
      const msg = `Search failed: ${e.message}`.slice(0, 500);
      if (d.type === 'tracker') {
        if (d.runId) await failUnfinishedRuns(this.prisma, { id: d.runId }, msg);
        return;
      }
      await failUnfinishedRuns(this.prisma, { batchId: d.batchId }, msg);
      const [failed, total] = await Promise.all([
        this.prisma.searchRun.count({ where: { batchId: d.batchId, status: 'FAILED' } }),
        this.prisma.searchRun.count({ where: { batchId: d.batchId } }),
      ]);
      await this.prisma.dailyBatch.update({
        where: { id: d.batchId },
        data: { completedAt: new Date(), trackersSucceeded: total - failed, trackersFailed: failed },
      });
    } catch (err: any) {
      this.log.error(`could not settle runs of a failed job: ${err.message}`);
    }
  }
}
