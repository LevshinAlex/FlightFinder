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
  /**
   * WhatsApp opt-in states: no phone → phone → consented → (settings) enabled.
   * Consent belongs to ONE number: it is given explicitly, and lost when the number changes or is removed.
   */
  async update(@CurrentUser() userId: string, @Body() dto: ProfileDto) {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const phone = dto.phone === undefined ? current.phone : dto.phone || null;
    const data: any = { name: dto.name, locale: dto.locale, timezone: dto.timezone, phone };
    if (dto.whatsappConsent === true && phone) {
      data.whatsappConsentAt = new Date();
    } else if (dto.whatsappConsent === false || !phone || phone !== current.phone) {
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
