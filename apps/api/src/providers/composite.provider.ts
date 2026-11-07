import {
  FlightProvider, IndicativeCriteria, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer,
  ProviderStatus, SearchCriteria,
} from './flight-provider.interface';

/**
 * Several providers behind one FlightProvider, in priority order.
 *
 * - Indicative: GAP FILLING. Each next provider is asked only for the (airport, dates) pairs the
 *   previous ones returned nothing usable for – indicative caches are incomplete by nature.
 * - Live: FAILOVER. The next provider is used only if the previous one failed or does not support
 *   the request. An empty answer is a real answer (NO_RESULTS) and is not retried elsewhere.
 *
 * Throws only when every provider failed, so the engine still tells "failed" from "no flights".
 */
export class CompositeProvider implements FlightProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  constructor(private readonly members: FlightProvider[]) {
    this.name = members.map((m) => m.name).join('+');
    this.capabilities = {
      indicativePrices: members.some((m) => m.capabilities.indicativePrices),
      liveSearch: members.some((m) => m.capabilities.liveSearch),
      flightDetails: false,
      bookingLink: false,
    };
  }

  async getIndicativePrices(c: IndicativeCriteria): Promise<ProviderOffer[]> {
    const pairKey = (d: string, dep: string, ret: string) => `${d}|${dep}|${ret}`;
    const missing = new Map<string, { destination: string; departureDate: string; returnDate: string }>();
    for (const destination of c.destinations)
      for (const x of c.combinations) missing.set(pairKey(destination, x.departureDate, x.returnDate), { destination, ...x });

    const out: ProviderOffer[] = [];
    let anyOk = false;
    let lastErr: unknown;
    for (const p of this.members.filter((m) => m.capabilities.indicativePrices)) {
      if (!missing.size) break;
      const byDest = new Map<string, { departureDate: string; returnDate: string }[]>();
      for (const m of missing.values()) {
        if (!byDest.has(m.destination)) byDest.set(m.destination, []);
        byDest.get(m.destination)!.push({ departureDate: m.departureDate, returnDate: m.returnDate });
      }
      for (const [destination, combinations] of byDest) {
        try {
          const offers = await p.getIndicativePrices({ ...c, destinations: [destination], combinations });
          anyOk = true;
          for (const o of offers) {
            const k = pairKey(o.destination, o.departureDate, o.returnDate);
            if (!missing.has(k)) continue; // other dates / already covered by a higher-priority provider
            out.push(o);
            const usable = c.maxStops == null || (o.outboundStops <= c.maxStops && o.inboundStops <= c.maxStops);
            if (usable) missing.delete(k);
          }
        } catch (e) {
          lastErr = e;
        }
      }
    }
    if (!anyOk && lastErr) throw lastErr;
    return out;
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    let lastErr: unknown = new ProviderNotSupportedError(this.name, 'searchFlights');
    for (const p of this.members.filter((m) => m.capabilities.liveSearch)) {
      try {
        return await p.searchFlights(c);
      } catch (e) {
        // keep the most meaningful error: a real failure beats "not supported"
        if (!(e instanceof ProviderNotSupportedError) || lastErr instanceof ProviderNotSupportedError) lastErr = e;
      }
    }
    throw lastErr;
  }

  async getFlightDetails(): Promise<ProviderOffer> {
    throw new ProviderNotSupportedError(this.name, 'getFlightDetails (call the offer\'s own provider)');
  }
  async getBookingLink(): Promise<string> {
    throw new ProviderNotSupportedError(this.name, 'getBookingLink (call the offer\'s own provider)');
  }
  async getProviderStatus(): Promise<ProviderStatus> {
    const all = await Promise.all(this.members.map((m) => m.getProviderStatus()));
    return {
      name: this.name,
      configured: all.some((s) => s.configured),
      healthy: all.some((s) => s.healthy),
      message: all.map((s) => `${s.name}: ${s.healthy ? 'ok' : 'down'}`).join(', '),
    };
  }
}
