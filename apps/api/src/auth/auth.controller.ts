import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { config } from '../common/config';
import { AuthService } from './auth.service';
import { AUTH_COOKIE, CurrentUser, JwtAuthGuard } from './jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

class RegisterDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(100) password: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsIn(['ru', 'en']) locale?: string;
}
class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 3600 * 1000, path: '/' };

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(dto.email, dto.password, dto.name, dto.locale);
    res.cookie(AUTH_COOKIE, this.auth.sign(user.id), cookieOpts);
    return { id: user.id, email: user.email, name: user.name };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(dto.email, dto.password);
    res.cookie(AUTH_COOKIE, this.auth.sign(user.id), cookieOpts);
    return { id: user.id, email: user.email, name: user.name };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true, locale: true, timezone: true, whatsappConsentAt: true, createdAt: true },
    });
  }

  @Get('providers')
  providers() {
    return { google: !!config.google.clientId };
  }

  // ---------- Google OAuth 2.0 (authorization code flow) ----------
  @Get('google')
  google(@Res() res: Response) {
    if (!config.google.clientId) throw new BadRequestException('Google sign-in is not configured');
    const state = randomBytes(16).toString('hex');
    res.cookie('ff_oauth_state', state, { ...cookieOpts, maxAge: 10 * 60 * 1000 });
    const qs = new URLSearchParams({
      client_id: config.google.clientId, redirect_uri: config.google.callbackUrl,
      response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${qs}`);
  }

  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
    if (!code || !state || state !== req.cookies?.ff_oauth_state) throw new BadRequestException('Invalid OAuth state');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: config.google.clientId, client_secret: config.google.clientSecret,
        redirect_uri: config.google.callbackUrl, grant_type: 'authorization_code',
      }),
    });
    const tokens: any = await tokenRes.json();
    if (!tokenRes.ok) throw new BadRequestException('Google token exchange failed');
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const info: any = await infoRes.json();
    if (!info.email_verified) throw new BadRequestException('Google email is not verified');
    const user = await this.auth.upsertGoogleUser(info.sub, info.email, info.name);
    res.clearCookie('ff_oauth_state', { path: '/' });
    res.cookie(AUTH_COOKIE, this.auth.sign(user.id), cookieOpts);
    res.redirect(`${config.webUrl}/dashboard`);
  }
}
