import { config } from '../common/config';
import {
  FlightProvider, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer, ProviderRequestError,
  ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { outboundOnlyOffers, resolveGoogleRoundTrip } from './google-flights';
import { providerFetch } from './http';

/**
 * HasData – Google Flights scraper (LIVE: scraped from Google Flights at request time).
 * Docs: https://docs.hasdata.com/apis/google-travel/flights
 * Free plan: 1000 credits / month, 15 credits per request → ~33 live checks (2 requests each).
 *
 * HasData does not document the accepted values of `stops` and `travelClass`, so we don't send them:
 * stops are filtered on our side from real segments, and only ECONOMY is supported until verified.
 */
export class HasDataProvider implements FlightProvider {
  readonly name = 'hasdata';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: true, flightDetails: false, bookingLink: true };
  private base = 'https://api.hasdata.com/scrape/google/flights';

  private get key() {
    if (!config.providers.hasdataKey) throw new ProviderRequestError(this.name, 'HASDATA_API_KEY not configured');
    return config.providers.hasdataKey;
  }

  private page(c: SearchCriteria, departureToken?: string): Promise<any> {
    const qs = new URLSearchParams({
      type: 'roundTrip', departureId: c.origin, arrivalId: c.destination,
      outboundDate: c.departureDate, returnDate: c.returnDate,
      adults: String(c.adults), currency: c.currency.toUpperCase(), hl: 'en',
    });
    if (departureToken) qs.set('departureToken', departureToken);
    return providerFetch(this.name, `${this.base}?${qs}`, { headers: { 'x-api-key': this.key } }, 90000);
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    if (c.cabinClass !== 'ECONOMY') throw new ProviderNotSupportedError(this.name, `searchFlights for cabin ${c.cabinClass}`);
    return resolveGoogleRoundTrip(this.name, c, (token) => this.page(c, token));
  }

  /** 1 request: outbound legs + round-trip "from" prices, no return legs (rankingOnly). */
  async searchOutboundOnly(c: SearchCriteria): Promise<ProviderOffer[]> {
    if (c.cabinClass !== 'ECONOMY') throw new ProviderNotSupportedError(this.name, `searchFlights for cabin ${c.cabinClass}`);
    return outboundOnlyOffers(this.name, c, await this.page(c));
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
    const configured = !!config.providers.hasdataKey;
    return { name: this.name, configured, healthy: configured, message: 'Google Flights via HasData; economy only; 2 requests per live check' };
  }
}
