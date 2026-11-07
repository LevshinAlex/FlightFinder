import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NOTIFY_QUEUE, NotifyJob } from '../search/queues';
import { NotificationService } from './notification.service';

@Processor(NOTIFY_QUEUE, { concurrency: 5 })
export class NotificationProcessor extends WorkerHost {
  constructor(private notifications: NotificationService) {
    super();
  }

  async process(job: Job<NotifyJob>) {
    const d = job.data;
    if (d.type === 'daily-summary') return this.notifications.sendDailySummary(d.userId, d.reportDate);
    return this.notifications.sendPriceDrop(d.userId, d.trackerId, d.searchRunId, d.reportDate);
  }
}
