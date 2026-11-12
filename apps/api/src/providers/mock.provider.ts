import {
  FlightProvider, IndicativeCriteria, ProviderCapabilities, ProviderNotSupportedError,
  ProviderOffer, ProviderStatus, ProviderUnavailableError, SearchCriteria,
} from './flight-provider.interface';

/**
 * Deterministic demo provider. Generates realistic-looking but FAKE prices so the
 * whole pipeline can run without API keys. Prices drift slightly day by day.
 * Never enable in production – offers are marked with provider "mock".
 */
const AIRLINES = ['El Al', 'Israir', 'Arkia', 'Wizz Air', 'Aegean', 'ITA Airways', 'Lufthansa', 'Turkish Airlines', 'Ryanair', 'easyJet'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Demo base prices are on a shekel scale. */
const CURRENCY_SCALE: Record<string, number> = { ILS: 1, USD: 0.27, EUR: 0.25, GBP: 0.21 };

export class MockFlightProvider implements FlightProvider {
  readonly name = 'mock';
  readonly capabilities: ProviderCapabilities = { indicativePrices: true, liveSearch: true, flightDetails: false, bookingLink: true };
  private failureRate = Number(process.env.MOCK_FAILURE_RATE ?? 0);

  private offer(c: Omit<SearchCriteria, 'maxStops'>, variant: number, status: 'LIVE' | 'INDICATIVE'): ProviderOffer {
    const key = `${c.origin}${c.destination}${c.departureDate}${c.returnDate}${variant}`;
    const today = process.env.MOCK_TODAY ?? new Date().toISOString().slice(0, 10); // demo backfill can override
    const base = 500 + hash(c.destination) * 2500;                 // destination "distance"
    const dateFactor = 0.85 + hash(c.departureDate + c.returnDate) * 0.4;
    const dayNum = Math.floor(Date.parse(today) / 86400e3);
    const wave = 1 + 0.12 * Math.sin(dayNum / 3 + hash(c.destination) * 6); // market trend per destination
    const daily = (0.94 + hash(key + today) * 0.12) * wave;          // + daily noise
    const outboundStops = Math.floor(hash(key + 'o') * 3);          // 0..2
    const inboundStops = Math.floor(hash(key + 'i') * 3);
    const stopsDiscount = 1 - 0.08 * (outboundStops + inboundStops);
    const indicativeNoise = status === 'INDICATIVE' ? 0.95 + hash(key + 'n') * 0.1 : 1;
    const scale = CURRENCY_SCALE[c.currency.toUpperCase()] ?? 1; // demo prices look plausible in any currency
    const price = Math.round(base * dateFactor * daily * stopsDiscount * indicativeNoise * c.adults * scale);
    const dur = Math.round(180 + hash(c.destination + 'd') * 600);
    return {
      provider: this.name,
      providerOfferId: `mock_${Buffer.from(key).toString('base64url').slice(0, 24)}`,
      origin: c.origin, destination: c.destination,
      departureDate: c.departureDate, returnDate: c.returnDate,
      airline: AIRLINES[Math.floor(hash(key + 'a') * AIRLINES.length)],
      outboundStops, inboundStops,
      outboundDurationMin: dur + outboundStops * 120,
      inboundDurationMin: dur + inboundStops * 120,
      price, currency: c.currency,
      baggageIncluded: hash(key + 'b') > 0.5,
      baggagePrice: hash(key + 'b') > 0.5 ? undefined : Math.round(150 * c.adults),
      selfTransfer: variant === 3 && outboundStops > 0,
      bookingUrl: `https://www.google.com/travel/flights?q=${encodeURIComponent(`flights ${c.origin} to ${c.destination} ${c.departureDate} return ${c.returnDate}`)}`,
      priceStatus: status,
      observedAt: new Date(Date.now() - (status === 'INDICATIVE' ? 36 * 3600e3 : 0)).toISOString(),
    };
  }

  private maybeFail() {
    if (this.failureRate > 0 && Math.random() < this.failureRate) throw new ProviderUnavailableError(this.name, 'simulated outage');
  }

  /** MOCK_LATENCY_MS: simulate a real provider's response time (demo / UI checks); 0 by default. */
  private async latency() {
    const ms = Number(process.env.MOCK_LATENCY_MS ?? 0);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  async getIndicativePrices(c: IndicativeCriteria): Promise<ProviderOffer[]> {
    this.maybeFail();
    const out: ProviderOffer[] = [];
    for (const destination of c.destinations)
      for (const combo of c.combinations)
        // indicative cache is incomplete: ~15% of combinations have no data
        if (hash(destination + combo.departureDate + combo.returnDate + 'gap') > 0.15)
          out.push(this.offer({ ...c, destination, ...combo }, 0, 'INDICATIVE'));
    return out;
  }

  async searchFlights(c: SearchCriteria): Promise<ProviderOffer[]> {
    await this.latency();
    this.maybeFail();
    return [0, 1, 2, 3].map((v) => this.offer(c, v, 'LIVE'));
  }

  async getFlightDetails(): Promise<ProviderOffer> {
    throw new ProviderNotSupportedError(this.name, 'getFlightDetails');
  }

  async getBookingLink(): Promise<string> {
    throw new ProviderNotSupportedError(this.name, 'getBookingLink (links are returned with offers)');
  }

  async getProviderStatus(): Promise<ProviderStatus> {
    return { name: this.name, configured: true, healthy: true, message: 'Demo data – not real prices' };
  }
}
