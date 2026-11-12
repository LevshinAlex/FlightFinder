import { config } from '../common/config';
import {
  FlightProvider, FlightSegment, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer, ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { iataFlightNumber } from './airlines';
import { rapidApiGet } from './rapidapi';

/**
 * "Skyscanner Scraper" by OmkarCloud on RapidAPI (LIVE; unofficial – scrapes skyscanner.net live search).
 * Docs (OpenAPI on the listing): https://rapidapi.com/OmkarCloud/api/skyscanner-scraper-1000-free-calls
 * Free BASIC plan: 1000 requests / month; one round-trip search = 1 request with both legs, real segments,
 * flight numbers, booking links per agent and a self-transfer flag. Average latency ~11 s (it polls Skyscanner).
 *
 * - Airports: plain IATA codes; `stops` = max stops per leg; `market` = point of sale (changes fares):
 *   SKYSCANNER_MARKET, default IL.
 * - To verify with the probe before relying on it: that price.amount is the total for all passengers.
 */
const HOST = 'skyscanner-scraper-1000-free-calls.p.rapidapi.com';
const CABIN: Record<string, string> = { ECONOMY: 'economy', PREMIUM_ECONOMY: 'premium_economy', BUSINESS: 'business', FIRST: 'first' };

export class SkyscannerScraperProvider implements FlightProvider {
  readonly name = 'skyscanner_scraper';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: true, flightDetails: false, bookingLink: true };

  private segments(leg: any): FlightSegment[] {
    return (leg?.segments ?? []).map((s: any) => ({
      from: s.origin?.code,
      to: s.destination?.code,
      departAt: s.departure_at, // local airport time, no offset
      arriveAt: s.arrival_at,
      carrier: s.marketing_carrier?.name ?? s.marketing_carrier?.code,
      // "DL5923"; Skyscanner's own codes ("I*6044") become IATA ("W46044")
      flightNumber: iataFlightNumber(s.flight_number ? String(s.flight_number) : undefined, s.marketing_carrier?.name),
    }));
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    const json = await rapidApiGet(this.name, HOST, '/flights/search-roundtrip', {
      origin: c.origin, destination: c.destination,
      depart_date: c.departureDate, return_date: c.returnDate,
      adults: String(c.adults), cabin_class: CABIN[c.cabinClass] ?? 'economy',
      stops: String(c.maxStops), currency: c.currency.toUpperCase(), market: config.providers.skyscannerMarket,
      // it polls Skyscanner server-side: stop polling in time to answer within our request limit
      sort: 'cheapest', max_results: '50', max_poll_seconds: String(Math.max(5, Math.floor(config.providers.timeoutMs / 1000) - 5)),
    });
    const observedAt = new Date().toISOString();
    const out: ProviderOffer[] = [];
    for (const r of json?.results ?? []) {
      const [outLeg, inLeg] = r.legs ?? [];
      const outSegs = this.segments(outLeg);
      const inSegs = this.segments(inLeg);
      if (r.price?.amount == null || !outSegs.length || !inSegs.length) continue; // no full round trip – never guess
      // the cheapest agent's deep link (the itinerary price is the cheapest option)
      const agents = (r.booking_options ?? []).flatMap((b: any) => b?.agents ?? []).filter((a: any) => a?.link);
      const best = agents.sort((a: any, b: any) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity))[0];
      out.push({
        provider: this.name,
        providerOfferId: r.id,
        origin: outSegs[0].from ?? c.origin,
        destination: outSegs[outSegs.length - 1].to ?? c.destination,
        departureDate: c.departureDate,
        returnDate: c.returnDate,
        airline: [...new Set([...outSegs, ...inSegs].map((s) => s.carrier).filter(Boolean))].join(', ') || undefined,
        outboundStops: outLeg?.stop_count ?? outSegs.length - 1,
        inboundStops: inLeg?.stop_count ?? inSegs.length - 1,
        outboundDurationMin: outLeg?.duration_minutes,
        inboundDurationMin: inLeg?.duration_minutes,
        segments: { outbound: outSegs, inbound: inSegs },
        price: Number(r.price.amount),
        currency: String(r.price.currency ?? c.currency).toUpperCase(),
        // "protected" self-transfer is still separate tickets – excluded in the MVP like any self-transfer
        selfTransfer: r.is_self_transfer === true || r.is_protected_self_transfer === true,
        bookingUrl: best?.link,
        priceStatus: 'LIVE',
        observedAt,
      });
    }
    return out;
  }

  async getIndicativePrices(): Promise<ProviderOffer[]> {
    throw new ProviderNotSupportedError(this.name, 'getIndicativePrices');
  }
  async getFlightDetails(): Promise<ProviderOffer> {
    throw new ProviderNotSupportedError(this.name, 'getFlightDetails');
  }
  async getBookingLink(): Promise<string> {
    throw new ProviderNotSupportedError(this.name, 'getBookingLink (links are returned with offers)');
  }
  async getProviderStatus(): Promise<ProviderStatus> {
    const configured = !!config.providers.rapidapiKey;
    return { name: this.name, configured, healthy: configured, message: 'Skyscanner via OmkarCloud scraper (RapidAPI, unofficial); 1 request per live check, ~11 s' };
  }
}
