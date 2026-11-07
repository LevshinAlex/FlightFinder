import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { initSentry } from './common/sentry';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  initSentry();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  console.log('Worker started: scheduler + search/notification queues');
}
bootstrap();
