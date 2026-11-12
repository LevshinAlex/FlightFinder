import { config } from './config';

/**
 * BullMQ connection options from REDIS_URL – the whole URL: redis[s]://[user:password@]host[:port][/db].
 * The database index keeps two apps on one Redis apart (their queues would otherwise steal each other's
 * jobs); rediss:// is TLS, which hosted Redis (Upstash, Redis Cloud, …) requires.
 */
export function redisConnection(url = config.redisUrl) {
  const u = new URL(url);
  const db = Number(decodeURIComponent(u.pathname.slice(1)) || 0);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number.isInteger(db) && db >= 0 ? db : 0,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
