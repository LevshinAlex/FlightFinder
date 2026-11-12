import { config } from '../common/config';
import {
  FlightProvider, FlightSegment, IndicativeCriteria, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer,
  ProviderRequestError, ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { carrierName } from './airlines';
import { providerFetch } from './http';

/**
 * Ignav – fares API (round trip with both legs in one request).
 * Docs: https://ignav.com/docs/round-trip , https://ignav.com/docs/booking-links
 * Free: 1000 requests, only successful requests billed.
 *
 * There is no currency parameter: prices come in the currency of the point-of-sale `market`
 * (IGNAV_MARKET, default IL – what travellers from Israel actually pay). The provider layer
 * converts them to the base currency (currency.ts) and keeps the original quote.
 * Ignav notes a search price is not a reserved fare nor a guarantee of a single combined ticket.
 */
const CABIN: Record<string, string> = { ECONOMY: 'economy', PREMIUM_ECONOMY: 'premium_economy', BUSINESS: 'business', FIRST: 'first' };
const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Trip length in days → its date pairs. */
export function groupByStay(combos: { departureDate: string; returnDate: string }[]) {
  const m = new Map<number, { departureDate: string; returnDate: string }[]>();
  for (const x of combos) {
    const stay = Math.round((ms(x.returnDate) - ms(x.departureDate)) / DAY);
    if (!m.has(stay)) m.set(stay, []);
    m.get(stay)!.push(x);
  }
  return m;
}

/** Covers the given dates with inclusive [start, end] windows of at most `maxDays` days. */
export function windows(dates: string[], maxDays: number): [string, string][] {
  const sorted = [...new Set(dates)].sort();
  const out: [string, string][] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && (ms(d) - ms(last[0])) / DAY < maxDays) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

export class IgnavProvider implements FlightProvider {
  readonly name = 'ignav';
  readonly capabilities: ProviderCapabilities = { indicativePrices: true, liveSearch: true, flightDetails: false, bookingLink: true };
  private base = 'https://ignav.com/api/fares';

  private headers() {
    if (!config.providers.ignavKey) throw new ProviderRequestError(this.name, 'IGNAV_API_KEY not configured');
    return { 'X-Api-Key': config.providers.ignavKey, 'Content-Type': 'application/json' };
  }

  private legs(leg: any): FlightSegment[] {
    return (leg?.segments ?? []).map((s: any) => ({
      from: s.departure_airport, to: s.arrival_airport,
      // local airport time, like Google Flights: what the traveller sees on the ticket; layovers stay correct (same airport)
      departAt: s.departure_time_local ?? s.departure_time_utc, arriveAt: s.arrival_time_local ?? s.arrival_time_utc,
      carrier: carrierName(s.marketing_carrier_code, s.operating_carrier_name), flightNumber: `${s.marketing_carrier_code ?? ''}${s.flight_number ?? ''}`,
    }));
  }

  private get market(): string {
    return config.providers.ignavMarket;
  }

  /**
   * Calendar prices via /cheapest-dates: one request covers up to 31 departure dates for ONE trip
   * length (`stay_days`), so combinations are grouped by stay length. Entries carry no itinerary
   * (no stops / airline) – offers are `rankingOnly`: they only decide what gets a live check.
   * Docs: https://ignav.com/docs/cheapest-dates
   */
  async getIndicativePrices(c: IndicativeCriteria): Promise<ProviderOffer[]> {
    const market = this.market;
    const out: ProviderOffer[] = [];
    for (const destination of c.destinations) {
      for (const [stay, combos] of groupByStay(c.combinations)) {
        const wanted = new Set(combos.map((x) => `${x.departureDate}|${x.returnDate}`));
        for (const [start, end] of windows(combos.map((x) => x.departureDate), 31)) {
          const body: Record<string, unknown> = {
            origin: c.origin, destination, departure_date_range: { start, end }, stay_days: stay,
            adults: c.adults, cabin_class: CABIN[c.cabinClass] ?? 'economy', market,
          };
          if (c.maxStops != null) body.max_stops = c.maxStops;
          const json = await providerFetch(this.name, `${this.base}/cheapest-dates`, {
            method: 'POST', headers: this.headers(), body: JSON.stringify(body),
          }, 60000);
          const observedAt = json?.observed_at ?? new Date().toISOString();
          for (const e of json?.dates ?? []) {
            const dep = e.departure_date ?? e.date;
            const ret = e.return_date;
            if (!e.price || e.price.amount == null || !wanted.has(`${dep}|${ret}`)) continue;
            out.push({
              provider: this.name, origin: c.origin, destination, departureDate: dep, returnDate: ret,
              // unknown – the request's max_stops filter is what guarantees the limit; never shown
              outboundStops: 0, inboundStops: 0,
              price: Number(e.price.amount), currency: String(e.price.currency ?? '').toUpperCase(),
              priceStatus: 'INDICATIVE', rankingOnly: true, observedAt,
            });
          }
        }
      }
    }
    return out;
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    const market = this.market;
    const body = {
      origin: c.origin, destination: c.destination,
      departure_date: c.departureDate, return_date: c.returnDate,
      adults: c.adults, cabin_class: CABIN[c.cabinClass] ?? 'economy', max_stops: c.maxStops, market,
    };
    const json = await providerFetch(this.name, `${this.base}/round-trip`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    }, 60000);

    const its: any[] = json?.itineraries ?? [];
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
          airline: [...new Set([...outSegs, ...inSegs].map((s) => s.carrier).filter(Boolean))].join(', ') || undefined,
          outboundStops: Math.max(0, outSegs.length - 1),
          inboundStops: Math.max(0, inSegs.length - 1),
          outboundDurationMin: i.outbound?.duration_minutes,
          inboundDurationMin: i.inbound?.duration_minutes,
          segments: { outbound: outSegs, inbound: inSegs },
          price: Number(i.price.amount),
          currency: String(i.price.currency ?? '').toUpperCase(), // market currency – converted by currency.ts
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

  async getFlightDetails(): Promise<ProviderOffer> {
    throw new ProviderNotSupportedError(this.name, 'getFlightDetails');
  }
  async getProviderStatus(): Promise<ProviderStatus> {
    const configured = !!config.providers.ignavKey;
    return { name: this.name, configured, healthy: configured, message: 'Round-trip fares; booking links cost 1 request' };
  }
}
