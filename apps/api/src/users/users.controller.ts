import { Body, Controller, Delete, Get, Put, Res, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Response } from 'express';
import { AUTH_COOKIE, CurrentUser, JwtAuthGuard } from '../auth/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

class ProfileDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  /** E.164, e.g. +972501234567; empty string removes the phone */
  @IsOptional() @Matches(/^(\+[1-9]\d{7,14})?$/) phone?: string;
  /** Explicit opt-in for WhatsApp messages (required by Meta policy) */
  @IsOptional() @IsBoolean() whatsappConsent?: boolean;
  @IsOptional() @IsIn(['ru', 'en']) locale?: string;
  @IsOptional() @IsString() timezone?: string;
}

const select = { id: true, email: true, name: true, phone: true, locale: true, timezone: true, whatsappConsentAt: true, createdAt: true };

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Get('profile')
  profile(@CurrentUser() userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select });
  }

  @Put('profile')
  async update(@CurrentUser() userId: string, @Body() dto: ProfileDto) {
    const phoneChanged = dto.phone !== undefined;
    const data: any = { name: dto.name, locale: dto.locale, timezone: dto.timezone };
    if (phoneChanged) data.phone = dto.phone || null;
    if (dto.whatsappConsent === true && (dto.phone || (await this.prisma.user.findUnique({ where: { id: userId } }))?.phone)) data.whatsappConsentAt = new Date();
    if (dto.whatsappConsent === false || (phoneChanged && !dto.phone)) {
      data.whatsappConsentAt = null;
      await this.prisma.notificationPreference.updateMany({ where: { userId }, data: { whatsappEnabled: false } });
    }
    return this.prisma.user.update({ where: { id: userId }, data, select });
  }

  /** GDPR-style removal of all personal data (cascades to trackers, history, logs). */
  @Delete('account')
  async remove(@CurrentUser() userId: string, @Res({ passthrough: true }) res: Response) {
    await this.prisma.user.delete({ where: { id: userId } });
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }
}
