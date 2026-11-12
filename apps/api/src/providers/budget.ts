import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../common/config';
import { ProviderQuotaExceededError } from './flight-provider.interface';

/**
 * Free-tier quotas of the flight APIs (20–300 requests a month each), so several free plans can be
 * combined without burning one in the first days of the month:
 *  - monthly limit per provider, in the units the provider bills (SerpApi searches, HasData credits, RapidAPI requests);
 *  - daily pacing: a day may spend at most (left this month) / (days left), so the quota lasts all month;
 *  - a provider that says "quota exceeded", or reports its own counter (RapidAPI headers), overrides our count.
 * Every HTTP request of a provider goes through reserve() (http.ts). Counters live in Redis: shared by
 * the API and all workers, reset by month / day (UTC).
 */
export const DEFAULT_MONTHLY_LIMITS: Record<string, number> = { serpapi: 250, hasdata: 1000, kiwi: 300, flightpowers: 50, skyscanner_scraper: 1000 };
/** Billing units per HTTP request (default 1). */
export const UNITS_PER_REQUEST: Record<string, number> = { hasdata: 15 };

const QUOTA_TEXT = /quota|run out of searches|out of credits|not enough credits|insufficient (credits|balance)|exceeded the (monthly|daily)|usage limit|upgrade your plan/i;
/** Does a provider error text mean "your plan is used up" (as opposed to a transient failure)? */
export const isQuotaMessage = (text: string) => QUOTA_TEXT.test(text);

export function parseLimits(spec: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of spec.split(',')) {
    const [name, value] = part.split(':').map((s) => s.trim());
    if (name && value && !isNaN(Number(value))) out[name.toLowerCase()] = Number(value);
  }
  return out;
}

export interface CounterStore {
  incrby(key: string, n: number, ttlSec: number): Promise<number>;
  get(key: string): Promise<number>;
  set(key: string, n: number, ttlSec: number): Promise<void>;
}

export class MemoryStore implements CounterStore {
  private m = new Map<string, { v: number; exp: number }>();
  private live(key: string) {
    const e = this.m.get(key);
    if (e && e.exp < Date.now()) this.m.delete(key);
    return this.m.get(key);
  }
  async incrby(key: string, n: number, ttlSec: number) {
    const e = this.live(key);
    const v = (e?.v ?? 0) + n;
    this.m.set(key, { v, exp: e?.exp ?? Date.now() + ttlSec * 1000 });
    return v;
  }
  async get(key: string) { return this.live(key)?.v ?? 0; }
  async set(key: string, n: number, ttlSec: number) { this.m.set(key, { v: n, exp: Date.now() + ttlSec * 1000 }); }
}

/** Redis-backed; falls back to process memory while Redis is unreachable (fail open, never blocks a search). */
class RedisStore implements CounterStore {
  private readonly log = new Logger('ProviderBudget');
  private redis: Redis | null = null;
  private fallback = new MemoryStore();
  private warned = false;
  private client() {
    if (!this.redis) {
      this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }
  private async run<T>(op: (r: Redis) => Promise<T>, fb: () => Promise<T>): Promise<T> {
    try { return await op(this.client()); } catch (e: any) {
      if (!this.warned) { this.log.warn(`Redis unavailable, counting quotas in memory: ${e.message}`); this.warned = true; }
      return fb();
    }
  }
  incrby(key: string, n: number, ttlSec: number) {
    return this.run(async (r) => {
      const v = await r.incrby(key, n);
      if (v === n) await r.expire(key, ttlSec);
      return v;
    }, () => this.fallback.incrby(key, n, ttlSec));
  }
  get(key: string) {
    return this.run(async (r) => Number((await r.get(key)) ?? 0), () => this.fallback.get(key));
  }
  set(key: string, n: number, ttlSec: number) {
    return this.run(async (r) => { await r.set(key, String(n), 'EX', ttlSec); }, () => this.fallback.set(key, n, ttlSec));
  }
}

export interface BudgetStatus {
  provider: string;
  limit: number | null;
  usedMonth: number;
  usedToday: number;
  /** what today may still spend (pacing + monthly limit); null = unlimited */
  todayLeft: number | null;
  blockedUntil: string | null;
}

export interface BudgetOptions {
  limits: Record<string, number>;
  unitsPerRequest?: Record<string, number>;
  pacing: boolean;
  enabled: boolean;
  store: CounterStore;
  now?: () => Date;
}

export class ProviderBudget {
  /** limits learnt from the provider's own quota headers */
  private discovered = new Map<string, number>();
  constructor(private o: BudgetOptions) {}

  private now() { return this.o.now ? this.o.now() : new Date(); }

  limit(provider: string): number | null {
    const l = this.o.limits[provider] ?? this.discovered.get(provider);
    return l && l > 0 ? l : null;
  }

  unitsPerRequest(provider: string) { return this.o.unitsPerRequest?.[provider] ?? 1; }

  private keys(provider: string) {
    const iso = this.now().toISOString();
    return { month: `ff:budget:${provider}:m:${iso.slice(0, 7)}`, day: `ff:budget:${provider}:d:${iso.slice(0, 10)}`, block: `ff:budget:${provider}:block` };
  }

  private endOfMonth() { const d = this.now(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
  private endOfDay() { const d = this.now(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)); }
  private ttlUntil(t: Date) { return Math.max(60, Math.ceil((t.getTime() - this.now().getTime()) / 1000) + 86400); }

  /** Days left in the month, today included. */
  private daysLeft() { return Math.max(1, Math.round((this.endOfMonth().getTime() - this.endOfDay().getTime()) / 86400e3) + 1); }

  /** Today's share: what was left at the start of the day, spread over the days left. */
  private dailyCap(limit: number, usedBeforeToday: number) {
    return Math.max(0, Math.ceil((limit - usedBeforeToday) / this.daysLeft()));
  }

  private async blockedUntil(provider: string): Promise<number | null> {
    const until = await this.o.store.get(this.keys(provider).block);
    return until > this.now().getTime() ? until : null;
  }

  /** Called before every HTTP request of a provider. Throws ProviderQuotaExceededError instead of sending it. */
  async reserve(provider: string): Promise<void> {
    if (!this.o.enabled) return;
    const blocked = await this.blockedUntil(provider);
    if (blocked) throw new ProviderQuotaExceededError(provider, `paused until ${new Date(blocked).toISOString()}`);
    const limit = this.limit(provider);
    if (limit == null) return;
    const units = this.unitsPerRequest(provider);
    const k = this.keys(provider);
    const month = await this.o.store.incrby(k.month, units, this.ttlUntil(this.endOfMonth()));
    const day = await this.o.store.incrby(k.day, units, 2 * 86400);
    const usedBeforeToday = month - day;
    let reason: string | null = null;
    if (month > limit) reason = `monthly free quota (${limit}) used up`;
    else if (this.o.pacing && day > this.dailyCap(limit, usedBeforeToday)) reason = "today's share of the monthly quota used up";
    if (reason) {
      await this.o.store.incrby(k.month, -units, this.ttlUntil(this.endOfMonth()));
      await this.o.store.incrby(k.day, -units, 2 * 86400);
      throw new ProviderQuotaExceededError(provider, reason);
    }
  }

  /** Units this provider may still spend today (Infinity = no limit). */
  async todayLeft(provider: string): Promise<number> {
    if (!this.o.enabled) return Infinity;
    if (await this.blockedUntil(provider)) return 0;
    const limit = this.limit(provider);
    if (limit == null) return Infinity;
    const k = this.keys(provider);
    const [month, day] = [await this.o.store.get(k.month), await this.o.store.get(k.day)];
    const monthLeft = limit - month;
    return Math.max(0, this.o.pacing ? Math.min(monthLeft, this.dailyCap(limit, month - day) - day) : monthLeft);
  }

  /**
   * The provider said its quota is used up: stop calling it until the quota resets – when it tells us
   * (RapidAPI x-ratelimit-requests-reset, seconds), else until the end of the hour / day / month it names.
   */
  async block(provider: string, message: string, resetInSec?: number) {
    if (!this.o.enabled) return;
    const until = resetInSec && resetInSec > 0 ? new Date(this.now().getTime() + resetInSec * 1000)
      : /hour/i.test(message) ? new Date(this.now().getTime() + 3600e3)
      : /\bday\b|daily|24 ?h/i.test(message) ? this.endOfDay()
      : this.endOfMonth();
    await this.o.store.set(this.keys(provider).block, until.getTime(), this.ttlUntil(until));
    new Logger('ProviderBudget').warn(`${provider}: quota exhausted, paused until ${until.toISOString()}`);
  }

  /** The provider reports its own counter (e.g. RapidAPI x-ratelimit-requests-*): it is the truth. */
  async sync(provider: string, limit: number, remaining: number) {
    if (!this.o.enabled || !(limit > 0) || !(remaining >= 0) || this.unitsPerRequest(provider) !== 1) return;
    if (this.o.limits[provider] == null) this.discovered.set(provider, limit);
    await this.o.store.set(this.keys(provider).month, Math.max(0, limit - remaining), this.ttlUntil(this.endOfMonth()));
  }

  async status(providers: string[]): Promise<BudgetStatus[]> {
    return Promise.all(providers.map(async (provider) => {
      const k = this.keys(provider);
      const left = await this.todayLeft(provider);
      const blocked = await this.blockedUntil(provider);
      return {
        provider, limit: this.limit(provider),
        usedMonth: await this.o.store.get(k.month), usedToday: await this.o.store.get(k.day),
        todayLeft: Number.isFinite(left) ? left : null,
        blockedUntil: blocked ? new Date(blocked).toISOString() : null,
      };
    }));
  }
}

export const providerBudget = new ProviderBudget({
  limits: { ...DEFAULT_MONTHLY_LIMITS, ...parseLimits(config.providers.monthlyLimits) },
  unitsPerRequest: UNITS_PER_REQUEST,
  pacing: config.providers.dailyPacing,
  enabled: config.providers.budgetsEnabled,
  store: new RedisStore(),
});
