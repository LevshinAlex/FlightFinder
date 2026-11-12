import { config } from '../common/config';
import { isQuotaMessage, providerBudget } from './budget';
import {
  FlightProvider, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer, ProviderQuotaExceededError, ProviderRequestError,
  ProviderStatus, SearchCriteria,
} from './flight-provider.interface';
import { outboundOnlyOffers, resolveGoogleRoundTrip } from './google-flights';
import { providerFetch } from './http';

/**
 * SerpApi – Google Flights engine (LIVE: scraped from Google Flights at request time).
 * Docs: https://serpapi.com/google-flights-api
 * Free plan: 250 searches / month, 50 / hour. Each live check costs 2 searches (outbound + return page).
 */
const TRAVEL_CLASS: Record<string, string> = { ECONOMY: '1', PREMIUM_ECONOMY: '2', BUSINESS: '3', FIRST: '4' };
// SerpApi `stops`: 1 = nonstop, 2 = ≤1 stop, 3 = ≤2 stops (0 = any). Google applies it to every leg.
const STOPS: Record<number, string> = { 0: '1', 1: '2', 2: '3' };
const NO_RESULTS = /hasn't returned any results/i;

export class SerpApiProvider implements FlightProvider {
  readonly name = 'serpapi';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: true, flightDetails: false, bookingLink: true };
  readonly requestsPerLiveCheck = 2; // outbound page + return page
  private base = 'https://serpapi.com/search.json';

  private get key() {
    if (!config.providers.serpapiKey) throw new ProviderRequestError(this.name, 'SERPAPI_KEY not configured');
    return config.providers.serpapiKey;
  }

  private async page(c: SearchCriteria, departureToken?: string): Promise<any> {
    const qs = new URLSearchParams({
      engine: 'google_flights', api_key: this.key, type: '1',
      departure_id: c.origin, arrival_id: c.destination,
      outbound_date: c.departureDate, return_date: c.returnDate,
      adults: String(c.adults), travel_class: TRAVEL_CLASS[c.cabinClass] ?? '1',
      stops: STOPS[c.maxStops] ?? '0', currency: c.currency.toUpperCase(), hl: 'en',
    });
    if (departureToken) qs.set('departure_token', departureToken);
    try {
      const json = await providerFetch(this.name, `${this.base}?${qs}`);
      if (json?.error) {
        if (NO_RESULTS.test(json.error)) return {};
        if (isQuotaMessage(json.error)) {
          await providerBudget.block(this.name, json.error);
          throw new ProviderQuotaExceededError(this.name, json.error);
        }
        throw new ProviderRequestError(this.name, json.error);
      }
      return json;
    } catch (e: any) {
      // SerpApi reports "no flights" as an error body – that is NO_RESULTS, not a provider failure
      if (e instanceof ProviderRequestError && NO_RESULTS.test(e.message)) return {};
      throw e;
    }
  }

  searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    return resolveGoogleRoundTrip(this.name, c, (token) => this.page(c, token));
  }

  /** 1 request: outbound legs + round-trip "from" prices, no return legs (rankingOnly). */
  async searchOutboundOnly(c: SearchCriteria): Promise<ProviderOffer[]> {
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
    const configured = !!config.providers.serpapiKey;
    return { name: this.name, configured, healthy: configured, message: 'Google Flights via SerpApi; 2 searches per live check' };
  }
}
