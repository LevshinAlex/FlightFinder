/**
 * DEV ONLY – DELETES existing search history of all active trackers, then
 * fills N past days of price history for all active trackers using the MOCK provider,
 * so the dashboard / charts have data right away.  Usage:
 *   npm run demo:history -w apps/api -- 14
 */
process.env.NODE_ENV = 'test'; // in-memory cache
process.env.INDICATIVE_PROVIDER = 'mock';
process.env.LIVE_PROVIDER = 'mock';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PrismaModule, PrismaService } from '../src/prisma/prisma.service';
import { SearchEngineService } from '../src/search/search-engine.service';
import { SearchCacheService } from '../src/search/search-cache.service';
import { AirportsService } from '../src/airports/airports.service';
import { ProviderRegistry } from '../src/providers/provider.registry';

@Module({ imports: [PrismaModule], providers: [SearchEngineService, SearchCacheService, AirportsService, ProviderRegistry] })
class BackfillModule {}

async function main() {
  const days = Number(process.argv[2] ?? 14);
  const app = await NestFactory.createApplicationContext(BackfillModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const engine = app.get(SearchEngineService);
  const cache = app.get(SearchCacheService) as any;
  const trackers = await prisma.flightTracker.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  const ids = trackers.map((t) => t.id);
  await prisma.searchRun.deleteMany({ where: { trackerId: { in: ids } } }); // cascades offers & snapshots
  for (let d = days; d >= 1; d--) {
    const when = new Date(Date.now() - d * 86400e3);
    process.env.MOCK_TODAY = when.toISOString().slice(0, 10);
    cache.memory.clear();
    const results = await engine.runForTrackers(ids, 'SCHEDULED');
    const runIds = results.map((r) => r.searchRunId);
    await prisma.searchRun.updateMany({ where: { id: { in: runIds } }, data: { startedAt: when, completedAt: when } });
    await prisma.priceSnapshot.updateMany({ where: { searchRunId: { in: runIds } }, data: { recordedAt: when } });
    await prisma.flightOffer.updateMany({ where: { searchRunId: { in: runIds } }, data: { observedAt: when } });
    console.log(`${process.env.MOCK_TODAY}: ${results.map((r) => r.status).join(', ')}`);
  }
  // today's run last, so trend compares with yesterday
  delete process.env.MOCK_TODAY;
  cache.memory.clear();
  const today = await engine.runForTrackers(ids, 'SCHEDULED');
  console.log(`today: ${today.map((r) => `${r.status} ${r.analysis?.priceChangePct ?? ''}%`).join(', ')}`);
  await app.close();
}
main();
