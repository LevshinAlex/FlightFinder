import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

class SettingsDto {
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @IsOptional() @IsBoolean() dailySummaryEnabled?: boolean;
  @IsOptional() @IsBoolean() priceDropAlertEnabled?: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(90) priceDropAlertPct?: number;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) preferredTime?: string;
  @IsOptional() @IsString() timezone?: string;
}

class TestDto {
  @IsOptional() @IsIn(['EMAIL', 'WHATSAPP']) channel?: 'EMAIL' | 'WHATSAPP';
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private prisma: PrismaService, private notifications: NotificationService) {}

  @Get('settings')
  async get(@CurrentUser() userId: string) {
    return this.prisma.notificationPreference.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  @Put('settings')
  async put(@CurrentUser() userId: string, @Body() dto: SettingsDto) {
    if (dto.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: dto.timezone }); } catch { dto.timezone = undefined; }
    }
    if (dto.whatsappEnabled) {
      const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (!u.phone || !u.whatsappConsentAt) dto.whatsappEnabled = false; // consent is mandatory
    }
    return this.prisma.notificationPreference.upsert({ where: { userId }, update: dto, create: { userId, ...dto } });
  }

  @Post('test')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  test(@CurrentUser() userId: string, @Body() dto: TestDto) {
    return this.notifications.sendTest(userId, dto.channel ?? 'EMAIL');
  }

  @Get('logs')
  logs(@CurrentUser() userId: string) {
    return this.prisma.notificationLog.findMany({ where: { userId }, orderBy: { sentAt: 'desc' }, take: 30 });
  }
}
