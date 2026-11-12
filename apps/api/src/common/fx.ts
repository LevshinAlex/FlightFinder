import { Logger } from '@nestjs/common';
import { config } from './config';

type Rates = { base: string; rates: Record<string, number>; at: number };

/**
 * Two response shapes are understood:
 *  - Frankfurter v2: [{ base: "USD", quote: "ILS", rate: 3.18 }, …]
 *  - { base | base_code: "USD", rates: { ILS: 3.18, … } }  (Frankfurter v1, open.er-api.com, …)
 */
export function parseRates(json: any): { base: string; rates: Record<string, number> } | null {
  if (Array.isArray(json)) {
    const base = String(json[0]?.base ?? '').toUpperCase();
    const rates: Record<string, number> = {};
    for (const r of json) if (r?.quote && Number(r.rate) > 0) rates[String(r.quote).toUpperCase()] = Number(r.rate);
    return base && Object.keys(rates).length ? { base, rates: { ...rates, [base]: 1 } } : null;
  }
  const base = String(json?.base ?? json?.base_code ?? '').toUpperCase();
  return base && json?.rates ? { base, rates: { ...json.rates, [base]: 1 } } : null;
}

/**
 * Daily reference exchange rates (no key, no card, no attribution: Frankfurter), cached for 12 h per process.
 */
export class FxRates {
  private readonly log = new Logger('FxRates');
  private cached: Rates | null = null;
  private pending: Promise<Rates> | null = null;

  constructor(private url: () => string = () => config.fxRatesUrl, private ttlMs = 12 * 3600e3) {}

  /** Test hook / manual override: `rates` = units of each currency per 1 `base`. */
  setRates(base: string, rates: Record<string, number>) {
    this.cached = { base: base.toUpperCase(), rates: { ...rates, [base.toUpperCase()]: 1 }, at: Date.now() };
  }

  private async load(): Promise<Rates> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached;
    this.pending ??= (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(this.url(), { signal: ctrl.signal }).finally(() => clearTimeout(t));
        const json: any = await res.json();
        const parsed = parseRates(json);
        if (!res.ok || !parsed) throw new Error(`HTTP ${res.status}`);
        this.cached = { ...parsed, at: Date.now() };
        return this.cached;
      } catch (e: any) {
        // stale rates beat no rates: a daily rate moves far less than flight prices do
        if (this.cached) { this.log.warn(`FX refresh failed, using rates from ${new Date(this.cached.at).toISOString()}: ${e.message}`); return this.cached; }
        throw new Error(`exchange rates unavailable: ${e.message}`);
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /** Units of `to` per 1 `from`. */
  async rate(from: string, to: string): Promise<number> {
    const f = from.toUpperCase(), t = to.toUpperCase();
    if (f === t) return 1;
    const r = await this.load();
    const rf = r.rates[f], rt = r.rates[t];
    if (!rf || !rt) throw new Error(`no exchange rate for ${f}→${t}`);
    return rt / rf;
  }
}

export const fx = new FxRates();

export const round2 = (n: number) => Math.round(n * 100) / 100;
