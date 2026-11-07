import { config } from '../common/config';
import {
  FlightProvider, FlightSegment, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer,
  ProviderRequestError, ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { providerFetch } from './http';

/**
 * Ignav – fares API (round trip with both legs in one request).
 * Docs: https://ignav.com/docs/round-trip , https://ignav.com/docs/booking-links
 * Free: 1000 requests, only successful requests billed.
 *
 * There is no currency parameter: the pricing currency follows `market`. We map the tracker currency
 * to a market and refuse (instead of converting) if the provider answers in another currency.
 * Ignav notes a search price is not a reserved fare nor a guarantee of a single combined ticket.
 */
const CABIN: Record<string, string> = { ECONOMY: 'economy', PREMIUM_ECONOMY: 'premium_economy', BUSINESS: 'business', FIRST: 'first' };
const MARKET: Record<string, string> = { ILS: 'IL', USD: 'US', GBP: 'GB', EUR: 'DE' };

export class IgnavProvider implements FlightProvider {
  readonly name = 'ignav';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: true, flightDetails: false, bookingLink: true };
  private base = 'https://ignav.com/api/fares';

  private headers() {
    if (!config.providers.ignavKey) throw new ProviderRequestError(this.name, 'IGNAV_API_KEY not configured');
    return { 'X-Api-Key': config.providers.ignavKey, 'Content-Type': 'application/json' };
  }

  private legs(leg: any): FlightSegment[] {
    return (leg?.segments ?? []).map((s: any) => ({
      from: s.departure_airport, to: s.arrival_airport,
      departAt: s.departure_time_utc ?? s.departure_time_local, arriveAt: s.arrival_time_utc ?? s.arrival_time_local,
      carrier: s.operating_carrier_name, flightNumber: `${s.marketing_carrier_code ?? ''}${s.flight_number ?? ''}`,
    }));
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    const currency = c.currency.toUpperCase();
    const market = MARKET[currency];
    if (!market) throw new ProviderNotSupportedError(this.name, `searchFlights in ${currency}`);
    const body = {
      origin: c.origin, destination: c.destination,
      departure_date: c.departureDate, return_date: c.returnDate,
      adults: c.adults, cabin_class: CABIN[c.cabinClass] ?? 'economy', max_stops: c.maxStops, market,
    };
    const json = await providerFetch(this.name, `${this.base}/round-trip`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    }, 60000);

    const its: any[] = json?.itineraries ?? [];
    const wrongCurrency = its.find((i) => i.price?.currency && String(i.price.currency).toUpperCase() !== currency);
    if (wrongCurrency) {
      throw new ProviderRequestError(this.name, `market ${market} priced in ${wrongCurrency.price.currency}, expected ${currency}`);
    }
    const observedAt = json?.observed_at ?? new Date().toISOString();
    return its
      .filter((i) => i.price?.amount != null)
      .map((i): ProviderOffer => {
        const outSegs = this.legs(i.outbound);
        const inSegs = this.legs(i.inbound);
        return {
          provider: this.name,
          providerOfferId: i.ignav_id,
          origin: outSegs[0]?.from ?? c.origin,
          destination: outSegs[outSegs.length - 1]?.to ?? c.destination,
          departureDate: c.departureDate,
          returnDate: c.returnDate,
          airline: [i.outbound?.carrier, i.inbound?.carrier].filter(Boolean).filter((v, k, a) => a.indexOf(v) === k).join(', ') || undefined,
          outboundStops: Math.max(0, outSegs.length - 1),
          inboundStops: Math.max(0, inSegs.length - 1),
          outboundDurationMin: i.outbound?.duration_minutes,
          inboundDurationMin: i.inbound?.duration_minutes,
          segments: { outbound: outSegs, inbound: inSegs },
          price: Number(i.price.amount),
          currency,
          // only "verified" prices are confirmed by Ignav; anything else is approximate
          priceStatus: i.price.status === 'verified' ? 'LIVE' : 'INDICATIVE',
          observedAt,
        };
      });
  }

  /** Costs one request; returns the first exact-flight link (falls back to any link). */
  async getBookingLink(offerId: string): Promise<string> {
    const json = await providerFetch(this.name, `${this.base}/booking-links`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ ignav_id: offerId }),
    });
    const links: any[] = (json?.booking_options ?? []).flatMap((o: any) => o.links ?? []);
    const best = links.find((l) => l.specificity === 'exact_flight') ?? links[0];
    if (!best?.url) throw new ProviderRequestError(this.name, `no booking link for ${offerId}`);
    return best.url;
  }

  async getIndicativePrices(): Promise<ProviderOffer[]> {
    throw new ProviderNotSupportedError(this.name, 'getIndicativePrices');
  }
  async getFlightDetails(): Promise<ProviderOffer> {
    throw new ProviderNotSupportedError(this.name, 'getFlightDetails');
  }
  async getProviderStatus(): Promise<ProviderStatus> {
    const configured = !!config.providers.ignavKey;
    return { name: this.name, configured, healthy: configured, message: 'Round-trip fares; booking links cost 1 request' };
  }
}
