import { config } from '../common/config';
import {
  FlightProvider, ProviderCapabilities, ProviderNotSupportedError, ProviderOffer, ProviderStatus,
} from './flight-provider.interface';

/**
 * Skyscanner Partners API (Indicative Prices + Live Prices) – PLACEHOLDER.
 * Access requires partner approval: https://developers.skyscanner.net/
 * Implement once credentials and the contract (allowed caching / storage of history,
 * redirect requirements) are confirmed – see docs/PROVIDER_EVALUATION.md.
 * All methods throw explicitly instead of returning fake data (spec 9).
 */
export class SkyscannerProvider implements FlightProvider {
  readonly name = 'skyscanner';
  readonly capabilities: ProviderCapabilities = { indicativePrices: false, liveSearch: false, flightDetails: false, bookingLink: false };

  async searchFlights(): Promise<ProviderOffer[]> { throw new ProviderNotSupportedError(this.name, 'searchFlights – awaiting partner access'); }
  async getIndicativePrices(): Promise<ProviderOffer[]> { throw new ProviderNotSupportedError(this.name, 'getIndicativePrices – awaiting partner access'); }
  async getFlightDetails(): Promise<ProviderOffer> { throw new ProviderNotSupportedError(this.name, 'getFlightDetails'); }
  async getBookingLink(): Promise<string> { throw new ProviderNotSupportedError(this.name, 'getBookingLink'); }
  async getProviderStatus(): Promise<ProviderStatus> {
    return { name: this.name, configured: !!config.providers.skyscannerKey, healthy: false, message: 'Adapter not implemented yet (partner access pending)' };
  }
}
