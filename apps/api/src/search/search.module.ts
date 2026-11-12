import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AirportsService } from '../airports/airports.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { NOTIFY_QUEUE, SEARCH_QUEUE } from './queues';
import { SearchCacheService } from './search-cache.service';
import { SearchEngineService } from './search-engine.service';
import { SearchQueueService } from './search-queue.service';

@Module({
  imports: [BullModule.registerQueue({ name: SEARCH_QUEUE }, { name: NOTIFY_QUEUE })],
  providers: [SearchEngineService, SearchCacheService, SearchQueueService, ProviderRegistry, AirportsService],
  exports: [SearchEngineService, SearchQueueService, SearchCacheService, ProviderRegistry, AirportsService, BullModule],
})
export class SearchModule {}
