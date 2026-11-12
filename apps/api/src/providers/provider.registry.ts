import { Injectable } from '@nestjs/common';
import { config } from '../common/config';
import { FlightProvider, ProviderCapabilities } from './flight-provider.interface';
import { providerBudget } from './budget';
import { CompositeProvider } from './composite.provider';
import { withCurrencyNormalization } from './currency';
import { MockFlightProvider } from './mock.provider';
import { TravelpayoutsProvider } from './travelpayouts.provider';
import { DuffelProvider } from './duffel.provider';
import { SkyscannerProvider } from './skyscanner.provider';
import { SerpApiProvider } from './serpapi.provider';
import { IgnavProvider } from './ignav.provider';
import { HasDataProvider } from './hasdata.provider';
import { KiwiProvider } from './kiwi.provider';
import { FlightPowersProvider } from './flightpowers.provider';
import { SkyscannerScraperProvider } from './skyscanner-scraper.provider';

@Injectable()
export class ProviderRegistry {
  private readonly all: Record<string, FlightProvider> = {
    mock: new MockFlightProvider(),
    travelpayouts: new TravelpayoutsProvider(),
    duffel: new DuffelProvider(),
    skyscanner: new SkyscannerProvider(),
    serpapi: new SerpApiProvider(),
    ignav: new IgnavProvider(),
    hasdata: new HasDataProvider(),
    kiwi: new KiwiProvider(),
    flightpowers: new FlightPowersProvider(),
    skyscanner_scraper: new SkyscannerScraperProvider(),
  };

  get(name: string): FlightProvider {
    const p = this.all[name];
    if (!p) throw new Error(`Unknown flight provider "${name}"`);
    return p;
  }

  private composites = new Map<string, FlightProvider>();

  /** "a, b" → providers a, b (in that order) having `capability`. */
  members(list: string, capability: keyof ProviderCapabilities): FlightProvider[] {
    return list.split(',').map((s) => s.trim()).filter(Boolean).map((n) => this.get(n)).filter((p) => p.capabilities[capability]);
  }

  /**
   * One → itself, several → CompositeProvider. Each member answers in the requested currency
   * (currency.ts), so a failed conversion makes the chain move on to the next member.
   */
  resolve(list: string, capability: keyof ProviderCapabilities): FlightProvider | null {
    const key = `${capability}:${list}`;
    if (this.composites.has(key)) return this.composites.get(key)!;
    const members = this.members(list, capability).map((m) => withCurrencyNormalization(m));
    const p = members.length === 0 ? null : members.length === 1 ? members[0] : new CompositeProvider(members);
    if (p) this.composites.set(key, p);
    return p;
  }

  /**
   * Live checks the live chain can still run today within the free quotas (budget.ts) –
   * the engine plans stage 2 with it instead of hitting providers that will refuse.
   * Infinity when any member has no quota limit.
   */
  async liveCheckAllowance(): Promise<number> {
    let total = 0;
    for (const p of this.members(config.providers.live, 'liveSearch')) {
      const left = await providerBudget.todayLeft(p.name);
      if (!Number.isFinite(left)) return Infinity;
      total += Math.floor(left / ((p.requestsPerLiveCheck ?? 1) * providerBudget.unitsPerRequest(p.name)));
    }
    return total;
  }

  /** Stage 1 (cheap, approximate). INDICATIVE_PROVIDER may list several: later ones fill gaps. */
  indicative(): FlightProvider | null {
    return this.resolve(config.providers.indicative, 'indicativePrices');
  }

  /** Stage 2 (live confirmation). LIVE_PROVIDER may list several: later ones take over on failure. */
  live(): FlightProvider | null {
    return this.resolve(config.providers.live, 'liveSearch');
  }

  /** Optional independent re-check of each tracker's cheapest live result (CONTROL_PROVIDER). */
  control(): FlightProvider | null {
    return config.providers.control ? this.resolve(config.providers.control, 'liveSearch') : null;
  }

  list(): FlightProvider[] {
    return Object.values(this.all);
  }
}
