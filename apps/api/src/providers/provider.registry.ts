import { Injectable } from '@nestjs/common';
import { config } from '../common/config';
import { FlightProvider, ProviderCapabilities } from './flight-provider.interface';
import { CompositeProvider } from './composite.provider';
import { MockFlightProvider } from './mock.provider';
import { TravelpayoutsProvider } from './travelpayouts.provider';
import { DuffelProvider } from './duffel.provider';
import { SkyscannerProvider } from './skyscanner.provider';
import { SerpApiProvider } from './serpapi.provider';
import { IgnavProvider } from './ignav.provider';
import { HasDataProvider } from './hasdata.provider';

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
  };

  get(name: string): FlightProvider {
    const p = this.all[name];
    if (!p) throw new Error(`Unknown flight provider "${name}"`);
    return p;
  }

  private composites = new Map<string, FlightProvider>();

  /** "a, b" → providers a then b having `capability`; one → itself, several → CompositeProvider. */
  resolve(list: string, capability: keyof ProviderCapabilities): FlightProvider | null {
    const key = `${capability}:${list}`;
    if (this.composites.has(key)) return this.composites.get(key)!;
    const members = list.split(',').map((s) => s.trim()).filter(Boolean)
      .map((n) => this.get(n)).filter((p) => p.capabilities[capability]);
    const p = members.length === 0 ? null : members.length === 1 ? members[0] : new CompositeProvider(members);
    if (p) this.composites.set(key, p);
    return p;
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
