import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { TrackerDto } from './tracker.dto';
import { TrackersService } from './trackers.service';

@Controller('trackers')
@UseGuards(JwtAuthGuard)
export class TrackersController {
  constructor(private trackers: TrackersService) {}

  @Get() list(@CurrentUser() u: string) { return this.trackers.list(u); }
  @Post() create(@CurrentUser() u: string, @Body() dto: TrackerDto) { return this.trackers.create(u, dto); }
  @Get(':id') get(@CurrentUser() u: string, @Param('id') id: string) { return this.trackers.get(u, id); }
  @Put(':id') update(@CurrentUser() u: string, @Param('id') id: string, @Body() dto: TrackerDto) { return this.trackers.update(u, id, dto); }
  @Delete(':id') remove(@CurrentUser() u: string, @Param('id') id: string) { return this.trackers.remove(u, id); }
  @Post(':id/pause') @HttpCode(200) pause(@CurrentUser() u: string, @Param('id') id: string) { return this.trackers.setStatus(u, id, 'PAUSED'); }
  @Post(':id/resume') @HttpCode(200) resume(@CurrentUser() u: string, @Param('id') id: string) { return this.trackers.setStatus(u, id, 'ACTIVE'); }
  @Get(':id/results') results(@CurrentUser() u: string, @Param('id') id: string) { return this.trackers.results(u, id); }
  @Get(':id/history') history(@CurrentUser() u: string, @Param('id') id: string, @Query('range') range = 'all') { return this.trackers.history(u, id, range); }
  @Get(':id/trends') trends(@CurrentUser() u: string, @Param('id') id: string) { return this.trackers.trends(u, id); }

  @Post(':id/search')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  search(@CurrentUser() u: string, @Param('id') id: string) { return this.trackers.manualSearch(u, id); }
}
