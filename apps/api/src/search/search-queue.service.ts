import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SEARCH_QUEUE, SearchJob } from './queues';

@Injectable()
export class SearchQueueService {
  constructor(@InjectQueue(SEARCH_QUEUE) private queue: Queue<SearchJob>) {}

  enqueueTracker(trackerId: string, trigger: 'MANUAL' | 'INITIAL') {
    return this.queue.add('tracker', { type: 'tracker', trackerId, trigger }, {
      jobId: `tracker-${trackerId}-${Math.floor(Date.now() / 60000)}`, // dedupe double clicks within a minute
      attempts: 2, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
  }

  enqueueBatch(trackerIds: string[], batchId: string) {
    return this.queue.add('batch', { type: 'batch', trackerIds, batchId }, {
      jobId: `batch-${batchId}`, attempts: 2, backoff: { type: 'exponential', delay: 60000 }, removeOnComplete: 1000, removeOnFail: 1000,
    });
  }
}
