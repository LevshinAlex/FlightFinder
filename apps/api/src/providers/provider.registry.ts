import { Injectable } from '@nestjs/common';
import { config } from '../common/config';
import { FlightProvider } from './flight-provider.interface';
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

  /** Stage 1 provider (cheap, approximate). Null if configured provider can't do indicative. */
  indicative(): FlightProvider | null {
    const p = this.get(config.providers.indicative);
    return p.capabilities.indicativePrices ? p : null;
  }

  /** Stage 2 provider (live confirmation). Null if none configured. */
  live(): FlightProvider | null {
    const p = this.get(config.providers.live);
    return p.capabilities.liveSearch ? p : null;
  }

  list(): FlightProvider[] {
    return Object.values(this.all);
  }
}
