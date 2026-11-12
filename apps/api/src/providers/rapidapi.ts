import { config } from '../common/config';
import { ProviderRequestError } from './flight-provider.interface';
import { providerFetch } from './http';

/**
 * RapidAPI gateway: one key (RAPIDAPI_KEY) for every listing; each listing needs its own (free BASIC)
 * subscription. Monthly quota "exceeded" answers and the x-ratelimit-requests-* headers are handled
 * in providerFetch / budget.ts.
 */
function headers(provider: string, host: string): Record<string, string> {
  if (!config.providers.rapidapiKey) throw new ProviderRequestError(provider, 'RAPIDAPI_KEY not configured');
  return { 'x-rapidapi-key': config.providers.rapidapiKey, 'x-rapidapi-host': host };
}

export function rapidApiGet(provider: string, host: string, path: string, params: Record<string, string>, timeoutMs?: number): Promise<any> {
  const h = headers(provider, host);
  return providerFetch(provider, `https://${host}${path}?${new URLSearchParams(params)}`, { headers: h }, timeoutMs);
}

export function rapidApiPost(provider: string, host: string, path: string, body: unknown, timeoutMs?: number): Promise<any> {
  const h = headers(provider, host);
  return providerFetch(provider, `https://${host}${path}`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, timeoutMs);
}
