import { config } from '../common/config';
import {
  FlightProvider, PriceInsight, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer, ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { rapidApiPost } from './rapidapi';

/**
 * FlightPowers – "Google Flights Live API" on RapidAPI (LIVE: Google Flights at request time).
 * Docs: https://flightpowers.com/flights-api/round-trip , https://flightpowers.com/openapi.json
 * Free BASIC plan: 50 requests / month; one round-trip search = 1 request, outbound and return already paired.
 *
 * - Returns Google's price band (low / typical / high + usual range) with every row.
 * - No segments, flight numbers or self-transfer flag: offers carry per-leg stops, airline names,
 *   leg durations and the Google Flights link (the UI then shows dates instead of times).
 * - `strict: true` turns a failed search into HTTP 503 (retried), so an empty array really means "no flights".
 * - To verify with the probe before relying on it: that total_price covers all passengers.
 */
const HOST = 'google-flights-live-api.p.rapidapi.com';
const SEAT: Record<string, number> = { ECONOMY: 1, PREMIUM_ECONOMY: 2, BUSINESS: 3, FIRST: 4 };

const num = (v: any): number | undefined => (v == null || v === '' || isNaN(Number(v)) ? undefined : Number(v));
/** "Berlin (BER)" → "BER" */
const iata = (s: any): string | undefined => /\(([A-Z]{3})\)\s*$/.exec(String(s ?? ''))?.[1];

/** "1 hr 50 min" / "45 min" / "3 hr" → minutes */
export function parseDurationText(s: any): number | undefined {
  const text = String(s ?? '');
  const h = /(\d+)\s*hr/.exec(text), m = /(\d+)\s*min/.exec(text);
  return h || m ? Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0) : undefined;
}

function insight(r: any): PriceInsight | undefined {
  const level = String(r.price_range_in_relation_to_other_periods ?? '').toLowerCase();
  const out: PriceInsight = {
    level: level === 'low' || level === 'typical' || level === 'high' ? level : undefined,
    typicalLow: num(r.price_insights_low),
    typicalHigh: num(r.price_insights_high),
  };
  return out.level || out.typicalLow != null ? out : undefined;
}

export class FlightPowersProvider implements FlightProvider {
  readonly name = 'flightpowers';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: true, flightDetails: false, bookingLink: true };

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    const json = await rapidApiPost(this.name, HOST, '/api/google_flights/roundtrip/v1', {
      from_airport: c.origin, to_airport: c.destination,
      departure_date: c.departureDate, return_date: c.returnDate,
      passengers: Array.from({ length: c.adults }, () => 1), // one entry per traveller, 1 = adult
      seat_type: SEAT[c.cabinClass] ?? 1,
      currency: c.currency.toUpperCase(),
      max_departure_stops: c.maxStops, max_return_stops: c.maxStops,
      sort_type: 'Price', limit: 10, strict: true,
    }, 90000);
    const rows: any[] = Array.isArray(json) ? json : json?.results ?? [];
    const observedAt = new Date().toISOString();
    const out: ProviderOffer[] = [];
    for (const r of rows) {
      const price = num(r.total_price_as_number);
      const outboundStops = num(r.departure_flight_stops);
      const inboundStops = num(r.return_flight_stops);
      if (price === undefined || outboundStops === undefined || inboundStops === undefined) continue; // never guess stops
      out.push({
        provider: this.name,
        origin: iata(r.from_airport) ?? c.origin,
        destination: iata(r.to_airport) ?? c.destination,
        departureDate: c.departureDate,
        returnDate: c.returnDate,
        airline: [...new Set([r.departure_flight_airline, r.return_flight_airline].filter(Boolean))].join(', ') || undefined,
        outboundStops, inboundStops,
        outboundDurationMin: parseDurationText(r.departure_flight_duration),
        inboundDurationMin: parseDurationText(r.return_flight_duration),
        price,
        currency: c.currency.toUpperCase(), // the response has no currency field – it is the one requested
        bookingUrl: r.buy_link || undefined,
        priceInsight: insight(r),
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
    throw new ProviderNotSupportedError(this.name, 'getBookingLink (Google Flights links are returned with offers)');
  }
  async getProviderStatus(): Promise<ProviderStatus> {
    const configured = !!config.providers.rapidapiKey;
    return { name: this.name, configured, healthy: configured, message: 'Google Flights via FlightPowers (RapidAPI); 1 request per live check, price band included' };
  }
}
