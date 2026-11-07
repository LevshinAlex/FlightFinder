import { config } from '../common/config';
import {
  FlightProvider, IndicativeCriteria, ProviderCapabilities, ProviderNotSupportedError,
  ProviderOffer, ProviderRequestError, ProviderStatus,
} from './flight-provider.interface';
import { providerFetch } from './http';

/**
 * Travelpayouts / Aviasales Data API (cached prices – INDICATIVE only).
 * Docs: https://support.travelpayouts.com/hc/en-us/articles/203956163
 * Endpoint used: GET /aviasales/v3/prices_for_dates
 * NOTE: prices come from users' search cache and are NOT a confirmation of a live fare.
 */
export class TravelpayoutsProvider implements FlightProvider {
  readonly name = 'travelpayouts';
  readonly capabilities: ProviderCapabilities = { indicativePrices: true, liveSearch: false, flightDetails: false, bookingLink: true };
  private base = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

  private get token() {
    if (!config.providers.travelpayoutsToken) throw new ProviderRequestError(this.name, 'TRAVELPAYOUTS_TOKEN not configured');
    return config.providers.travelpayoutsToken;
  }

  async getIndicativePrices(c: IndicativeCriteria): Promise<ProviderOffer[]> {
    if (c.cabinClass !== 'ECONOMY') return []; // data API covers economy fares only
    const out: ProviderOffer[] = [];
    for (const destination of c.destinations) {
      for (const combo of c.combinations) {
        const qs = new URLSearchParams({
          origin: c.origin, destination,
          departure_at: combo.departureDate, return_at: combo.returnDate,
          currency: c.currency.toLowerCase(), sorting: 'price', unique: 'false',
          one_way: 'false', limit: '30', token: this.token,
        });
        const json = await providerFetch(this.name, `${this.base}?${qs}`);
        if (!json?.success) continue;
        for (const r of json.data ?? []) {
          out.push({
            provider: this.name,
            origin: r.origin_airport ?? c.origin,
            destination: r.destination_airport ?? destination,
            departureDate: String(r.departure_at).slice(0, 10),
            returnDate: String(r.return_at).slice(0, 10),
            airline: r.airline,
            outboundStops: Number(r.transfers ?? 0),
            inboundStops: Number(r.return_transfers ?? 0),
            outboundDurationMin: r.duration_to,
            inboundDurationMin: r.duration_back,
            // Data API price is per ONE adult – scale to passengers
            price: Number(r.price) * c.adults,
            currency: (json.currency ?? c.currency).toUpperCase(),
            bookingUrl: r.link
              ? `https://www.aviasales.com${r.link}${config.providers.travelpayoutsMarker ? `&marker=${config.providers.travelpayoutsMarker}` : ''}`
              : undefined,
            priceStatus: 'INDICATIVE',
            observedAt: new Date().toISOString(),
          });
        }
      }
    }
    return out;
  }

  async searchFlights(): Promise<ProviderOffer[]> {
    throw new ProviderNotSupportedError(this.name, 'searchFlights (live search)');
  }
  async getFlightDetails(): Promise<ProviderOffer> {
    throw new ProviderNotSupportedError(this.name, 'getFlightDetails');
  }
  async getBookingLink(): Promise<string> {
    throw new ProviderNotSupportedError(this.name, 'getBookingLink (links are returned with offers)');
  }
  async getProviderStatus(): Promise<ProviderStatus> {
    return {
      name: this.name,
      configured: !!config.providers.travelpayoutsToken,
      healthy: !!config.providers.travelpayoutsToken,
      message: 'Cached prices; not a live fare confirmation',
    };
  }
}
