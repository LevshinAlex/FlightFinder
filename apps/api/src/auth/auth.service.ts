import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  sign(userId: string) {
    return this.jwt.sign({ sub: userId });
  }

  async register(email: string, password: string, name?: string, locale?: string) {
    const normalized = email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email: normalized } })) throw new ConflictException('Email already registered');
    const user = await this.prisma.user.create({
      data: { email: normalized, passwordHash: await bcrypt.hash(password, 12), name, locale: locale === 'en' ? 'en' : 'ru', preferences: { create: {} } },
    });
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Invalid email or password');
    return user;
  }

  async upsertGoogleUser(googleId: string, email: string, name?: string) {
    const normalized = email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ googleId }, { email: normalized }] } });
    if (existing) {
      return existing.googleId ? existing : this.prisma.user.update({ where: { id: existing.id }, data: { googleId } });
    }
    return this.prisma.user.create({ data: { email: normalized, googleId, name, preferences: { create: {} } } });
  }
}
