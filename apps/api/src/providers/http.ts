import { ProviderRequestError, ProviderUnavailableError } from './flight-provider.interface';

/** fetch wrapper that maps HTTP failures to retryable / non-retryable provider errors. */
export async function providerFetch(provider: string, url: string, init: RequestInit = {}, timeoutMs = 30000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      throw new ProviderUnavailableError(provider, `HTTP ${res.status}`, isNaN(ra) ? undefined : ra * 1000);
    }
    if (!res.ok) throw new ProviderRequestError(provider, `HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } catch (e: any) {
    if (e instanceof ProviderUnavailableError || e instanceof ProviderRequestError) throw e;
    throw new ProviderUnavailableError(provider, e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e));
  } finally {
    clearTimeout(t);
  }
}
