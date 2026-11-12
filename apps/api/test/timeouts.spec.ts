/**
 * PROVIDER_TIMEOUT_SECONDS: no provider request is awaited longer than the limit, a timeout is never
 * retried (the chain moves on), and a running search's partial results are filtered like the final ones.
 */
import { config } from '../src/common/config';
import { redisConnection } from '../src/common/redis';
import { CompositeProvider } from '../src/providers/composite.provider';
import {
  FlightProvider, ProviderOffer, ProviderTimeoutError, ProviderUnavailableError, SearchCriteria,
} from '../src/providers/flight-provider.interface';
import { providerFetch } from '../src/providers/http';
import { withRetry } from '../src/providers/retry';
import { partialOffers } from '../src/search/run-progress';

const LIMIT_MS = 150;
const realFetch = global.fetch;
const realLimit = config.providers.timeoutMs;
beforeEach(() => { config.providers.timeoutMs = LIMIT_MS; });
afterEach(() => { global.fetch = realFetch; config.providers.timeoutMs = realLimit; });

/** A fetch that never answers – it only reacts to the abort signal, like a hung provider. */
const hangingFetch = () => jest.fn((_url: any, init?: RequestInit) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
}));

describe('provider request limit', () => {
  it('a hung provider fails with ProviderTimeoutError after the limit – even when the call asks for longer', async () => {
    global.fetch = hangingFetch() as any;
    const t0 = Date.now();
    const err = await providerFetch('slow', 'https://example.test/search', {}, 60_000).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderTimeoutError);
    expect(err).toBeInstanceOf(ProviderUnavailableError); // still a temporary failure for the chain
    expect(Date.now() - t0).toBeLessThan(LIMIT_MS + 1000);
  });

  it('the limit also covers a body that never finishes', async () => {
    global.fetch = jest.fn((_url: any, init?: RequestInit) => Promise.resolve({
      status: 200, ok: true, headers: new Headers(),
      text: () => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    } as unknown as Response)) as any;
    await expect(providerFetch('slow', 'https://example.test/search')).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('a shorter per-call timeout still applies', async () => {
    global.fetch = hangingFetch() as any;
    const t0 = Date.now();
    await expect(providerFetch('slow', 'https://example.test/search', {}, 30)).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(Date.now() - t0).toBeLessThan(LIMIT_MS);
  });
});

describe('retries', () => {
  it('a timeout is not retried', async () => {
    const fn = jest.fn(() => Promise.reject(new ProviderTimeoutError('slow', LIMIT_MS)));
    await expect(withRetry(fn, 3, 1)).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a temporary failure (5xx) is still retried', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new ProviderUnavailableError('flaky', 'HTTP 503'))
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a Retry-After longer than the limit is not awaited', async () => {
    const fn = jest.fn(() => Promise.reject(new ProviderUnavailableError('busy', 'HTTP 429', 3_600_000)));
    const t0 = Date.now();
    await expect(withRetry(fn, 3, 1)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

const criteria: SearchCriteria = {
  origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20', adults: 1, cabinClass: 'ECONOMY', currency: 'USD', maxStops: 1,
};
const offer = (p: Partial<ProviderOffer> = {}): ProviderOffer => ({
  provider: 'test', origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
  outboundStops: 0, inboundStops: 0, price: 500, currency: 'USD', priceStatus: 'LIVE', observedAt: new Date().toISOString(), ...p,
});
const provider = (name: string, searchFlights: () => Promise<ProviderOffer[]>): FlightProvider => ({
  name, capabilities: { indicativePrices: false, liveSearch: true, flightDetails: false, bookingLink: false },
  searchFlights, getIndicativePrices: async () => [], getFlightDetails: async () => { throw new Error('n/a'); },
  getBookingLink: async () => { throw new Error('n/a'); }, getProviderStatus: async () => ({ name, configured: true, healthy: true }),
});

describe('live chain after a timeout', () => {
  it('the next provider answers instead of the one that timed out', async () => {
    const chain = new CompositeProvider([
      provider('slow', () => Promise.reject(new ProviderTimeoutError('slow', LIMIT_MS))),
      provider('fast', async () => [offer({ provider: 'fast', price: 420 })]),
    ]);
    const res = await chain.searchFlights(criteria);
    expect(res.map((o) => [o.provider, o.price])).toEqual([['fast', 420]]);
  });
});

describe('partial results of a running search', () => {
  it('are filtered like the final result: cheapest per route, cheapest first, no calendar-only prices', () => {
    const res = partialOffers([
      offer({ destination: 'FCO', price: 700 }),
      offer({ destination: 'FCO', price: 650 }), // same route, cheaper → kept instead of 700
      offer({ destination: 'MXP', price: 400 }),
      offer({ destination: 'NAP', price: 300, rankingOnly: true }), // calendar hint: never shown
      offer({ destination: 'BLQ', price: 200, outboundStops: 2 }), // too many stops for maxStops 1
      offer({ destination: 'VCE', price: 250, currency: 'EUR' }), // not the base currency
    ], 1, 'USD');
    expect(res.map((o) => [o.destination, o.price])).toEqual([['MXP', 400], ['FCO', 650]]);
  });

  it('are capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => offer({ departureDate: `2027-05-${String(i % 28 + 1).padStart(2, '0')}`, returnDate: '2027-06-01', price: 300 + i }));
    expect(partialOffers(many, 1, 'USD', 15)).toHaveLength(15);
  });
});

describe('REDIS_URL → queue connection', () => {
  it('keeps the database index (two apps on one Redis must not share queues)', () => {
    expect(redisConnection('redis://localhost:6379/1')).toMatchObject({ host: 'localhost', port: 6379, db: 1 });
    expect(redisConnection('redis://localhost:6379')).toMatchObject({ db: 0 });
  });
  it('rediss:// is TLS; credentials are decoded', () => {
    const c = redisConnection('rediss://default:p%40ss%2Fw0rd@eu1.example.io:6380');
    expect(c).toMatchObject({ host: 'eu1.example.io', port: 6380, username: 'default', password: 'p@ss/w0rd', tls: {} });
    expect(redisConnection('redis://localhost:6379')).not.toHaveProperty('tls');
  });
});

describe('provider lists from env', () => {
  it('"none" / "off" switch a stage off; unset falls back to the default', () => {
    const { providerList } = jest.requireActual('../src/common/config');
    expect(providerList('none', 'mock')).toBe('');
    expect(providerList(' OFF ', 'mock')).toBe('');
    expect(providerList(undefined, 'mock')).toBe('mock');
    expect(providerList('skyscanner_scraper,kiwi', 'mock')).toBe('skyscanner_scraper,kiwi');
  });
});
