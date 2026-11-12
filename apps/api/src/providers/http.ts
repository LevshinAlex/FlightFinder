import { config } from '../common/config';
import { isQuotaMessage, providerBudget } from './budget';
import { ProviderQuotaExceededError, ProviderRequestError, ProviderTimeoutError, ProviderUnavailableError } from './flight-provider.interface';

/**
 * fetch wrapper that maps HTTP failures to retryable / non-retryable provider errors and keeps the
 * provider's free quota (budget.ts): a request over budget is refused before it is sent.
 * Every request – reading the body included – ends within PROVIDER_TIMEOUT_SECONDS (`timeoutMs` may only shorten it).
 */
export async function providerFetch(provider: string, url: string, init: RequestInit = {}, timeoutMs?: number): Promise<any> {
  await providerBudget.reserve(provider);
  const limitMs = Math.min(timeoutMs ?? config.providers.timeoutMs, config.providers.timeoutMs);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), limitMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    // RapidAPI (and some others) report the plan's own counter – it beats ours
    const limit = Number(res.headers.get('x-ratelimit-requests-limit'));
    const remaining = Number(res.headers.get('x-ratelimit-requests-remaining'));
    if (res.headers.has('x-ratelimit-requests-remaining') && !isNaN(limit) && !isNaN(remaining)) {
      await providerBudget.sync(provider, limit, remaining);
    }
    if ([402, 403, 429].includes(res.status) && isQuotaMessage(text)) {
      const reset = Number(res.headers.get('x-ratelimit-requests-reset'));
      await providerBudget.block(provider, text, isNaN(reset) ? undefined : reset);
      throw new ProviderQuotaExceededError(provider, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      throw new ProviderUnavailableError(provider, `HTTP ${res.status}`, isNaN(ra) ? undefined : ra * 1000);
    }
    if (!res.ok) throw new ProviderRequestError(provider, `HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } catch (e: any) {
    if (e instanceof ProviderUnavailableError || e instanceof ProviderRequestError) throw e;
    if (ctrl.signal.aborted) throw new ProviderTimeoutError(provider, limitMs);
    throw new ProviderUnavailableError(provider, String(e?.message ?? e));
  } finally {
    clearTimeout(t);
  }
}
