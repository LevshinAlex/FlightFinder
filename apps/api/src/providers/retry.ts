import { config } from '../common/config';
import { ProviderTimeoutError, ProviderUnavailableError } from './flight-provider.interface';

/**
 * Retries temporary failures (5xx, 429, network). Never a timeout (it would only double the wait), and never
 * when the provider asks for a longer pause than one request may take (PROVIDER_TIMEOUT_SECONDS).
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 1000, maxDelayMs = config.providers.timeoutMs): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!(e instanceof ProviderUnavailableError) || e instanceof ProviderTimeoutError || i === attempts - 1) throw e;
      const delay = e.retryAfterMs ?? baseDelayMs * 2 ** i;
      if (delay > maxDelayMs) throw e;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Minimal concurrency limiter (like p-limit). */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(next);
      };
      active < concurrency ? run() : queue.push(run);
    });
  };
}
