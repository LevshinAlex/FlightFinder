import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { config } from '../common/config';

/**
 * Shared cache of provider responses, keyed by normalised search parameters.
 * 100 users tracking the same route & dates → one provider call (spec 4.2).
 */
@Injectable()
export class SearchCacheService implements OnModuleDestroy {
  private readonly log = new Logger(SearchCacheService.name);
  private redis: Redis | null = null;
  private memory = new Map<string, { exp: number; value: string }>();

  constructor() {
    if (process.env.NODE_ENV !== 'test') {
      this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
      this.redis.on('error', (e) => this.log.warn(`Redis cache error: ${e.message}`));
    }
  }

  static key(kind: string, provider: string, params: Record<string, unknown>): string {
    const norm = JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
    return `ff:cache:${kind}:${provider}:${createHash('sha1').update(norm).digest('hex')}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = this.redis ? await this.redis.get(key) : this.memGet(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlMin = config.providers.cacheTtlMin) {
    const raw = JSON.stringify(value);
    try {
      if (this.redis) await this.redis.set(key, raw, 'EX', ttlMin * 60);
      else this.memory.set(key, { exp: Date.now() + ttlMin * 60e3, value: raw });
    } catch (e: any) {
      this.log.warn(`cache set failed: ${e.message}`);
    }
  }

  private memGet(key: string) {
    const v = this.memory.get(key);
    if (!v || v.exp < Date.now()) return null;
    return v.value;
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
