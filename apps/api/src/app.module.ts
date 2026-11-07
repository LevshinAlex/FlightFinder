import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AirportsController } from './airports/airports.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt.guard';
import { config } from './common/config';
import { NotificationModule } from './notifications/notification.module';
import { PrismaModule } from './prisma/prisma.service';
import { SearchModule } from './search/search.module';
import { TrackersModule } from './trackers/trackers.module';
import { UsersController } from './users/users.controller';

export const redisConnection = () => {
  const u = new URL(config.redisUrl);
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, username: u.username || undefined };
};

export const JwtGlobal = JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: '30d' } });

/** HTTP API process. Does NOT run search/notification workers. */
@Module({
  imports: [
    PrismaModule,
    JwtGlobal,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRoot({ connection: redisConnection() }),
    SearchModule,
    TrackersModule,
    NotificationModule,
  ],
  controllers: [AuthController, UsersController, AirportsController, AdminController],
  providers: [AuthService, JwtAuthGuard, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
