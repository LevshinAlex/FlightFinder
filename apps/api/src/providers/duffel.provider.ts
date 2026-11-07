import { config } from '../common/config';
import {
  FlightProvider, FlightSegment, IndicativeCriteria, ProviderCapabilities, ProviderNotSupportedError,
  ProviderOffer, ProviderRequestError, ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { providerFetch } from './http';

/**
 * Duffel Air API – LIVE offers.
 * Docs: https://duffel.com/docs/api/v2/offer-requests
 * Commercial note: Duffel charges for excess searches above the search-to-book ratio.
 * Duffel sells tickets itself: there is no external deep link, so getBookingLink is unsupported.
 */
const CABIN: Record<string, string> = { ECONOMY: 'economy', PREMIUM_ECONOMY: 'premium_economy', BUSINESS: 'business', FIRST: 'first' };

function isoDurationToMin(d?: string): number | undefined {
  if (!d) return undefined;
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export class DuffelProvider implements FlightProvider {
  readonly name = 'duffel';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: true, flightDetails: true, bookingLink: false };
  private base = 'https://api.duffel.com';

  private headers() {
    if (!config.providers.duffelToken) throw new ProviderRequestError(this.name, 'DUFFEL_ACCESS_TOKEN not configured');
    return {
      Authorization: `Bearer ${config.providers.duffelToken}`,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private map(o: any, c?: SearchCriteria): ProviderOffer {
    const seg = (s: any): FlightSegment => ({
      from: s.origin?.iata_code, to: s.destination?.iata_code,
      departAt: s.departing_at, arriveAt: s.arriving_at,
      carrier: s.marketing_carrier?.name, flightNumber: `${s.marketing_carrier?.iata_code ?? ''}${s.marketing_carrier_flight_number ?? ''}`,
    });
    const [out, inb] = o.slices ?? [];
    const outSegs = (out?.segments ?? []).map(seg);
    const inSegs = (inb?.segments ?? []).map(seg);
    const checked = (out?.segments?.[0]?.passengers?.[0]?.baggages ?? []).find((b: any) => b.type === 'checked');
    return {
      provider: this.name,
      providerOfferId: o.id,
      origin: outSegs[0]?.from ?? c?.origin,
      destination: outSegs[outSegs.length - 1]?.to ?? c?.destination,
      departureDate: (outSegs[0]?.departAt ?? c?.departureDate ?? '').slice(0, 10),
      returnDate: (inSegs[0]?.departAt ?? c?.returnDate ?? '').slice(0, 10),
      airline: o.owner?.name,
      outboundStops: Math.max(0, outSegs.length - 1),
      inboundStops: Math.max(0, inSegs.length - 1),
      outboundDurationMin: isoDurationToMin(out?.duration),
      inboundDurationMin: isoDurationToMin(inb?.duration),
      segments: { outbound: outSegs, inbound: inSegs },
      price: Number(o.total_amount),             // total for all passengers, taxes included
      currency: o.total_currency,
      baggageIncluded: checked ? checked.quantity > 0 : undefined,
      fareId: o.slices?.[0]?.fare_brand_name,
      priceStatus: 'LIVE',
      expiresAt: o.expires_at,
      observedAt: new Date().toISOString(),
    };
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    const body = {
      data: {
        slices: [
          { origin: c.origin, destination: c.destination, departure_date: c.departureDate },
          { origin: c.destination, destination: c.origin, departure_date: c.returnDate },
        ],
        passengers: Array.from({ length: c.adults }, () => ({ type: 'adult' })),
        cabin_class: CABIN[c.cabinClass],
        max_connections: c.maxStops,
      },
    };
    const json = await providerFetch(this.name, `${this.base}/air/offer_requests?return_offers=true&supplier_timeout=20000`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    }, 60000);
    return (json?.data?.offers ?? []).map((o: any) => this.map(o, c));
  }

  async getFlightDetails(offerId: string): Promise<ProviderOffer> {
    const json = await providerFetch(this.name, `${this.base}/air/offers/${encodeURIComponent(offerId)}`, { headers: this.headers() });
    return this.map(json.data);
  }

  async getIndicativePrices(_c: IndicativeCriteria): Promise<ProviderOffer[]> {
    throw new ProviderNotSupportedError(this.name, 'getIndicativePrices');
  }
  async getBookingLink(): Promise<string> {
    throw new ProviderNotSupportedError(this.name, 'getBookingLink (Duffel sells via API; no external deep link)');
  }
  async getProviderStatus(): Promise<ProviderStatus> {
    return { name: this.name, configured: !!config.providers.duffelToken, healthy: !!config.providers.duffelToken };
  }
}
