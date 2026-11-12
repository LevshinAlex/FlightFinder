import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtGlobal } from './app.module';
import { redisConnection } from './common/redis';
import { NotificationModule } from './notifications/notification.module';
import { NotificationProcessor } from './notifications/notification.processor';
import { PrismaModule } from './prisma/prisma.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { SearchModule } from './search/search.module';
import { SearchProcessor } from './search/search.processor';

/** Background process: scheduler + queue consumers. Scale horizontally by running more workers. */
@Module({
  imports: [
    PrismaModule,
    JwtGlobal,
    ScheduleModule.forRoot(),
    BullModule.forRoot({ connection: redisConnection() }),
    SearchModule,
    NotificationModule,
  ],
  providers: [SearchProcessor, NotificationProcessor, SchedulerService],
})
export class WorkerModule {}
