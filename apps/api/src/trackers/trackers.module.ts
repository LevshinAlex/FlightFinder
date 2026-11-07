import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { TrackersController } from './trackers.controller';
import { TrackersService } from './trackers.service';

@Module({ imports: [SearchModule], controllers: [TrackersController], providers: [TrackersService] })
export class TrackersModule {}
