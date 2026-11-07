/**
 * Unified flight data provider contract (spec section 9).
 * Missing capabilities MUST throw ProviderNotSupportedError – never fake data.
 */

export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

export interface SearchCriteria {
  origin: string;            // IATA
  destination: string;       // IATA
  departureDate: string;     // YYYY-MM-DD
  returnDate: string;        // YYYY-MM-DD
  adults: number;
  cabinClass: CabinClass;
  currency: string;          // ISO 4217
  maxStops: number;          // per direction
}

export interface IndicativeCriteria {
  origin: string;
  destinations: string[];
  combinations: { departureDate: string; returnDate: string }[];
  adults: number;
  cabinClass: CabinClass;
  currency: string;
  /** Per direction. Providers that can filter server-side should; others ignore it. */
  maxStops?: number;
}

export interface FlightSegment {
  from: string;
  to: string;
  departAt?: string;
  arriveAt?: string;
  carrier?: string;
  flightNumber?: string;
}

export interface ProviderOffer {
  provider: string;
  providerOfferId?: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  airline?: string;
  outboundStops: number;
  inboundStops: number;
  outboundDurationMin?: number;
  inboundDurationMin?: number;
  segments?: { outbound: FlightSegment[]; inbound: FlightSegment[] };
  /** Total round-trip price for ALL passengers incl. known mandatory taxes */
  price: number;
  currency: string;
  baggageIncluded?: boolean;
  baggagePrice?: number;
  fareId?: string;
  bookingUrl?: string;
  /** true if itinerary is a self-transfer between separate tickets */
  selfTransfer?: boolean;
  priceStatus: 'LIVE' | 'INDICATIVE';
  /**
   * Price-only hint without itinerary details (e.g. calendar prices): used to choose which
   * combinations get a live check, never stored or shown – its stops/airline are not known.
   */
  rankingOnly?: boolean;
  expiresAt?: string;
  observedAt: string;        // ISO timestamp from provider (cache age) or now
}

export interface ProviderCapabilities {
  indicativePrices: boolean;
  liveSearch: boolean;
  flightDetails: boolean;
  bookingLink: boolean;
}

export interface ProviderStatus {
  name: string;
  configured: boolean;
  healthy: boolean;
  message?: string;
}

export interface FlightProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  searchFlights(criteria: SearchCriteria): Promise<ProviderOffer[]>;
  getIndicativePrices(criteria: IndicativeCriteria): Promise<ProviderOffer[]>;
  getFlightDetails(offerId: string): Promise<ProviderOffer>;
  getBookingLink(offerId: string): Promise<string>;
  getProviderStatus(): Promise<ProviderStatus>;
}

export class ProviderNotSupportedError extends Error {
  constructor(provider: string, method: string) {
    super(`${provider}: ${method} is not supported by this provider`);
    this.name = 'ProviderNotSupportedError';
  }
}

/** Temporary failure (timeouts, 5xx, 429) – safe to retry. */
export class ProviderUnavailableError extends Error {
  constructor(provider: string, message: string, readonly retryAfterMs?: number) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderUnavailableError';
  }
}

/** Non-retryable failure (bad credentials, invalid request). */
export class ProviderRequestError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderRequestError';
  }
}
