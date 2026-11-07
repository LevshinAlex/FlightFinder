import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_QUEUE, NotifyJob, SEARCH_QUEUE, SearchJob } from './queues';
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
    const started = Date.now();
    const d = job.data;
    if (d.type === 'tracker') {
      const r = await this.engine.runForTrackers([d.trackerId], d.trigger);
      this.log.log(`tracker ${d.trackerId}: ${r[0]?.status ?? 'skipped (paused/deleted)'} in ${Date.now() - started}ms`);
      return r;
    }

    const results = await this.engine.runForTrackers(d.trackerIds, 'SCHEDULED', d.batchId);
    // trackers paused/deleted after queueing: drop their placeholder runs (test #7)
    await this.prisma.searchRun.deleteMany({ where: { batchId: d.batchId, status: 'QUEUED' } });
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
      const bigDrop = a.priceChangePct != null && a.priceChangePct <= -prefs.priceDropAlertPct;
      if (bigDrop || a.targetReached) {
        const reportDate = DateTime.now().setZone(prefs.timezone).toISODate()!;
        await this.notify.add('price-drop', { type: 'price-drop', userId: tracker.userId, trackerId: tracker.id, searchRunId: r.searchRunId, reportDate }, {
          jobId: `drop-${tracker.id}-${reportDate}`, attempts: 3, backoff: { type: 'exponential', delay: 60000 },
        });
      }
    }
    return { ok, total: results.length };
  }
}
