import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { config } from './common/config';
import { initSentry } from './common/sentry';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  initSentry();
  const app = await NestFactory.create(AppModule);
  // Behind proxies (Vercel rewrite → Render): take the client IP from X-Forwarded-For, trusting
  // exactly TRUST_PROXY hops – so rate limits are per user, not shared by everyone behind the proxy.
  const hops = Number(process.env.TRUST_PROXY ?? 0);
  if (hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config.webUrl, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`API listening on :${config.port}`);

  // Single-service hosting (e.g. one free instance): run the scheduler + queue consumers in-process.
  if (process.env.RUN_WORKER === 'true') {
    const worker = await NestFactory.createApplicationContext(WorkerModule);
    worker.enableShutdownHooks();
    console.log('Worker started in-process: scheduler + search/notification queues');
  }
}
bootstrap();
