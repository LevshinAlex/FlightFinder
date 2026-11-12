import { config } from '../common/config';
import {
  FlightProvider, FlightSegment, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer, ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { rapidApiGet } from './rapidapi';

/**
 * Kiwi.com Flights API on RapidAPI (LIVE; unofficial – it scrapes kiwi.com, it is not Kiwi's Tequila API).
 * Docs (OpenAPI on the listing): https://rapidapi.com/elis-lab-2-elis-lab-2-default/api/kiwi-com-flights-api
 * Free BASIC plan: 300 requests / month; one round-trip search = 1 request with both legs and real segments.
 *
 * - Airports are plain IATA codes (the API also accepts its own ids, not needed here).
 * - The round-trip endpoint has no stops filter: stops are counted from segments and filtered by the engine.
 * - Self-transfer ("virtual interlining", separate tickets) = any layover that needs a baggage recheck.
 * - To verify with the probe before relying on it: that `price.amount` is the total for all passengers.
 */
const HOST = 'kiwi-com-flights-api.p.rapidapi.com';
const CABIN: Record<string, string> = { ECONOMY: 'ECONOMY', PREMIUM_ECONOMY: 'PREMIUM_ECONOMY', BUSINESS: 'BUSINESS', FIRST: 'FIRST_CLASS' };

export class KiwiProvider implements FlightProvider {
  readonly name = 'kiwi';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: true, flightDetails: false, bookingLink: true };

  private legs(sector: any): FlightSegment[] {
    return (sector?.segments ?? []).map((s: any) => ({
      from: s.source?.station?.code,
      to: s.destination?.station?.code,
      departAt: s.source?.local_time,
      arriveAt: s.destination?.local_time,
      carrier: s.carrier?.name ?? s.carrier?.code,
      // the API gives the number without the airline ("701") – prefix the IATA code like other providers
      flightNumber: s.flight_number ? `${s.carrier?.code ?? ''}${s.flight_number}` : undefined,
    }));
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    const json = await rapidApiGet(this.name, HOST, '/api/v1/flights/search-roundtrip', {
      source: c.origin, destination: c.destination,
      departure_date: c.departureDate, return_date: c.returnDate,
      adults: String(c.adults), cabin_class: CABIN[c.cabinClass] ?? 'ECONOMY',
      currency: c.currency.toUpperCase(), sort_by: 'PRICE', limit: '50',
    }, 90000); // the probe measured 24 s
    const observedAt = new Date().toISOString();
    const out: ProviderOffer[] = [];
    for (const i of json?.itineraries ?? []) {
      const outSegs = this.legs(i.outbound);
      const inSegs = this.legs(i.inbound);
      if (i.price?.amount == null || !outSegs.length || !inSegs.length) continue; // no full round trip – skip, never guess
      const layovers = [...(i.outbound?.layovers ?? []), ...(i.inbound?.layovers ?? [])];
      out.push({
        provider: this.name,
        providerOfferId: i.id,
        origin: outSegs[0].from ?? c.origin,
        destination: outSegs[outSegs.length - 1].to ?? c.destination,
        departureDate: c.departureDate,
        returnDate: c.returnDate,
        airline: [...new Set([...outSegs, ...inSegs].map((s) => s.carrier).filter(Boolean))].join(', ') || undefined,
        outboundStops: outSegs.length - 1,
        inboundStops: inSegs.length - 1,
        outboundDurationMin: i.outbound?.duration_seconds != null ? Math.round(i.outbound.duration_seconds / 60) : undefined,
        inboundDurationMin: i.inbound?.duration_seconds != null ? Math.round(i.inbound.duration_seconds / 60) : undefined,
        segments: { outbound: outSegs, inbound: inSegs },
        price: Number(i.price.amount),
        currency: String(i.price.currency ?? json.currency ?? c.currency).toUpperCase(),
        selfTransfer: layovers.some((l: any) => l?.is_baggage_recheck === true || /self|virtual/i.test(String(l?.transfer_type ?? ''))),
        bookingUrl: (i.booking_options ?? []).find((b: any) => b?.booking_url)?.booking_url,
        priceStatus: 'LIVE',
        observedAt,
      });
    }
    return out;
  }

  async getIndicativePrices(): Promise<ProviderOffer[]> {
    // its price calendar is one-way (no return date) – no use for round-trip ranking
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
    return { name: this.name, configured, healthy: configured, message: 'Kiwi.com via RapidAPI (unofficial); 1 request per live check' };
  }
}
