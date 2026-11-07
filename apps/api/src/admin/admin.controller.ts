import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider.registry';

const ADMINS = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

@Controller()
export class AdminController {
  constructor(private prisma: PrismaService, private providers: ProviderRegistry) {}

  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  }

  /** Monitoring (spec 13): last daily run, processed / failed, provider and delivery status. */
  @Get('admin/status')
  @UseGuards(JwtAuthGuard)
  async status(@CurrentUser() userId: string) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!ADMINS.includes(me.email)) throw new ForbiddenException();
    const since = new Date(Date.now() - 24 * 3600e3);
    const [lastBatch, runs, notif, activeTrackers, users] = await Promise.all([
      this.prisma.dailyBatch.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.searchRun.groupBy({ by: ['status'], where: { startedAt: { gte: since } }, _count: true }),
      this.prisma.notificationLog.groupBy({ by: ['channel', 'status'], where: { sentAt: { gte: since } }, _count: true }),
      this.prisma.flightTracker.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count(),
    ]);
    return {
      users, activeTrackers, lastBatch,
      searchRuns24h: runs.map((r) => ({ status: r.status, count: r._count })),
      notifications24h: notif.map((n) => ({ channel: n.channel, status: n.status, count: n._count })),
      providers: await Promise.all(this.providers.list().map((p) => p.getProviderStatus())),
    };
  }
}
