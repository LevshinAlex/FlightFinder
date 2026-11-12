import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SEARCH_QUEUE, SearchJob } from './queues';

@Injectable()
export class SearchQueueService {
  constructor(@InjectQueue(SEARCH_QUEUE) private queue: Queue<SearchJob>, private prisma: PrismaService) {}

  /**
   * Creates the run as QUEUED right away (see run-state.ts), so the search is "in progress" for the
   * API and the UI from the moment it is requested – not only once a worker picks the job up.
   * Callers check for an active run first; the job id is the run id, so every run has exactly one job.
   */
  async enqueueTracker(trackerId: string, trigger: 'MANUAL' | 'INITIAL') {
    const run = await this.prisma.searchRun.create({ data: { trackerId, trigger, status: 'QUEUED' } });
    try {
      await this.queue.add('tracker', { type: 'tracker', trackerId, trigger, runId: run.id }, {
        jobId: `run-${run.id}`, attempts: 2, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 1000, removeOnFail: 1000,
      });
    } catch (e) {
      await this.prisma.searchRun.delete({ where: { id: run.id } }).catch(() => undefined); // no job → no run
      throw e;
    }
    return run;
  }

  enqueueBatch(trackerIds: string[], batchId: string) {
    return this.queue.add('batch', { type: 'batch', trackerIds, batchId }, {
      jobId: `batch-${batchId}`, attempts: 2, backoff: { type: 'exponential', delay: 60000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
  }
}
