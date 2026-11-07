/**
 * Several providers per stage: indicative gap filling, live failover, control check, Ignav calendar.
 */
import { config } from '../src/common/config';
import { CompositeProvider } from '../src/providers/composite.provider';
import {
  FlightProvider, IndicativeCriteria, ProviderNotSupportedError, ProviderOffer, ProviderUnavailableError, SearchCriteria,
} from '../src/providers/flight-provider.interface';
import { groupByStay, IgnavProvider, windows } from '../src/providers/ignav.provider';
import { ProviderRegistry } from '../src/providers/provider.registry';
import { compareControl, pickControlCriteria, TrackerSearchPlan } from '../src/search/search-planner';

const offer = (p: Partial<ProviderOffer>): ProviderOffer => ({
  provider: 'test', origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
  outboundStops: 0, inboundStops: 0, price: 1000, currency: 'ILS', priceStatus: 'LIVE', observedAt: '2026-11-07T00:00:00Z', ...p,
});

const fake = (name: string, impl: Partial<FlightProvider>, caps: Partial<FlightProvider['capabilities']> = {}): FlightProvider & { calls: any[] } => {
  const calls: any[] = [];
  return {
    name, calls,
    capabilities: { indicativePrices: true, liveSearch: true, flightDetails: false, bookingLink: false, ...caps },
    getIndicativePrices: async (c: IndicativeCriteria) => { calls.push(c); return impl.getIndicativePrices ? impl.getIndicativePrices(c) : []; },
    searchFlights: async (c: SearchCriteria) => { calls.push(c); return impl.searchFlights ? impl.searchFlights(c) : []; },
    getFlightDetails: async () => { throw new Error('n/a'); },
    getBookingLink: async () => { throw new Error('n/a'); },
    getProviderStatus: async () => ({ name, configured: true, healthy: true }),
  };
};

const ind: IndicativeCriteria = {
  origin: 'TLV', destinations: ['FCO', 'MXP'], adults: 1, cabinClass: 'ECONOMY', currency: 'ILS', maxStops: 1,
  combinations: [{ departureDate: '2027-05-10', returnDate: '2027-05-20' }, { departureDate: '2027-05-11', returnDate: '2027-05-20' }],
};
const crit: SearchCriteria = {
  origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20', adults: 1, cabinClass: 'ECONOMY', currency: 'ILS', maxStops: 1,
};

describe('CompositeProvider – indicative gap filling', () => {
  it('asks the next provider only for pairs the previous one did not cover', async () => {
    const a = fake('a', { getIndicativePrices: async () => [
      offer({ provider: 'a', destination: 'FCO', departureDate: '2027-05-10', price: 900 }),
      offer({ provider: 'a', destination: 'FCO', departureDate: '2027-05-11', outboundStops: 2 }), // too many stops → still a gap
    ] });
    const b = fake('b', { getIndicativePrices: async (c) => c.combinations.map((x) => offer({ provider: 'b', destination: c.destinations[0], ...x })) });
    const res = await new CompositeProvider([a, b]).getIndicativePrices(ind);

    // b: FCO only the 11th, MXP both dates
    const asked = b.calls.map((c: IndicativeCriteria) => `${c.destinations[0]}:${c.combinations.map((x) => x.departureDate.slice(8)).join(',')}`).sort();
    expect(asked).toEqual(['FCO:11', 'MXP:10,11']);
    expect(res.filter((o) => o.provider === 'b')).toHaveLength(3);
    expect(res.find((o) => o.destination === 'FCO' && o.departureDate === '2027-05-10')!.provider).toBe('a');
  });

  it('a failing provider is skipped; throws only if all fail', async () => {
    const down = fake('down', { getIndicativePrices: async () => { throw new ProviderUnavailableError('down', 'HTTP 503'); } });
    const ok = fake('ok', { getIndicativePrices: async (c) => [offer({ provider: 'ok', destination: c.destinations[0] })] });
    await expect(new CompositeProvider([down, ok]).getIndicativePrices(ind)).resolves.toHaveLength(2);
    await expect(new CompositeProvider([down, down]).getIndicativePrices(ind)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe('CompositeProvider – live failover', () => {
  it('empty answer is final (NO_RESULTS), not retried elsewhere', async () => {
    const a = fake('a', { searchFlights: async () => [] });
    const b = fake('b', { searchFlights: async () => [offer({})] });
    await expect(new CompositeProvider([a, b]).searchFlights(crit)).resolves.toEqual([]);
    expect(b.calls).toHaveLength(0);
  });

  it('failure / not-supported → next provider', async () => {
    const down = fake('down', { searchFlights: async () => { throw new ProviderUnavailableError('down', 'timeout'); } });
    const ns = fake('ns', { searchFlights: async () => { throw new ProviderNotSupportedError('ns', 'cabin'); } });
    const ok = fake('ok', { searchFlights: async () => [offer({ provider: 'ok' })] });
    const [o] = await new CompositeProvider([ns, down, ok]).searchFlights(crit);
    expect(o.provider).toBe('ok');
  });

  it('all failed → the real failure is reported, not "not supported"', async () => {
    const down = fake('down', { searchFlights: async () => { throw new ProviderUnavailableError('down', 'timeout'); } });
    const ns = fake('ns', { searchFlights: async () => { throw new ProviderNotSupportedError('ns', 'cabin'); } });
    await expect(new CompositeProvider([down, ns]).searchFlights(crit)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe('ProviderRegistry lists', () => {
  const saved = { ...config.providers };
  afterEach(() => Object.assign(config.providers, saved));

  it('single name → the provider itself (same cache keys as before)', () => {
    config.providers.live = 'duffel';
    expect(new ProviderRegistry().live()!.name).toBe('duffel');
  });
  it('list → composite, members without the capability are dropped', () => {
    config.providers.indicative = 'travelpayouts, duffel, ignav';   // duffel has no indicative
    config.providers.live = 'ignav,serpapi';
    config.providers.control = 'serpapi';
    const r = new ProviderRegistry();
    expect(r.indicative()!.name).toBe('travelpayouts+ignav');
    expect(r.live()!.name).toBe('ignav+serpapi');
    expect(r.control()!.name).toBe('serpapi');
  });
  it('no control by default', () => {
    config.providers.control = '';
    expect(new ProviderRegistry().control()).toBeNull();
  });
});

describe('Ignav cheapest-dates (indicative)', () => {
  it('groups combinations by trip length and covers dates with ≤31-day windows', () => {
    const g = groupByStay([
      { departureDate: '2027-05-10', returnDate: '2027-05-20' },
      { departureDate: '2027-05-11', returnDate: '2027-05-21' },
      { departureDate: '2027-05-11', returnDate: '2027-05-20' },
    ]);
    expect([...g.keys()].sort()).toEqual([10, 9].sort());
    expect(g.get(10)).toHaveLength(2);
    expect(windows(['2027-05-10', '2027-06-09', '2027-06-10', '2027-05-12'], 31)).toEqual([['2027-05-10', '2027-06-09'], ['2027-06-10', '2027-06-10']]);
  });

  it('one request per stay length; offers are rankingOnly INDICATIVE for the wanted pairs only', async () => {
    config.providers.ignavKey = 'ig-key';
    const bodies: any[] = [];
    global.fetch = jest.fn(async (_u: any, init: any) => {
      const b = JSON.parse(init.body); bodies.push(b);
      const dates = [];
      for (let d = Date.parse(`${b.departure_date_range.start}T00:00:00Z`); d <= Date.parse(`${b.departure_date_range.end}T00:00:00Z`); d += 86_400_000) {
        const dep = new Date(d).toISOString().slice(0, 10);
        const ret = new Date(d + b.stay_days * 86_400_000).toISOString().slice(0, 10);
        dates.push({ departure_date: dep, return_date: ret, price: { amount: 800 + b.stay_days, currency: 'ILS', status: 'unverified' } });
      }
      return new Response(JSON.stringify({ observed_at: '2026-11-07T10:00:00Z', dates }), { status: 200 });
    }) as any;

    const res = await new IgnavProvider().getIndicativePrices({
      ...ind, destinations: ['FCO'],
      combinations: [
        { departureDate: '2027-05-10', returnDate: '2027-05-20' }, // stay 10
        { departureDate: '2027-05-12', returnDate: '2027-05-22' }, // stay 10 (11th not wanted)
        { departureDate: '2027-05-11', returnDate: '2027-05-20' }, // stay 9
      ],
    });
    expect(bodies).toHaveLength(2);
    expect(bodies.find((b) => b.stay_days === 10)).toMatchObject({
      origin: 'TLV', destination: 'FCO', departure_date_range: { start: '2027-05-10', end: '2027-05-12' }, max_stops: 1, market: 'IL',
    });
    expect(res.map((o) => o.departureDate).sort()).toEqual(['2027-05-10', '2027-05-11', '2027-05-12']);
    expect(res.every((o) => o.rankingOnly && o.priceStatus === 'INDICATIVE')).toBe(true);
  });
});

describe('Control check', () => {
  const plan: TrackerSearchPlan = {
    trackerId: 't', origin: 'TLV', destinations: ['FCO', 'MXP'], adults: 1, cabinClass: 'ECONOMY', currency: 'ILS', maxStops: 1,
    combinations: [{ departureDate: '2027-05-10', returnDate: '2027-05-20' }],
  };
  const cands: SearchCriteria[] = [crit, { ...crit, destination: 'MXP' }];

  it('targets the cheapest usable LIVE route', () => {
    const c = pickControlCriteria(plan, cands, [
      offer({ destination: 'FCO', price: 1200 }),
      offer({ destination: 'MXP', price: 1100 }),
      offer({ destination: 'FCO', price: 500, outboundStops: 2 }),        // violates stops
      offer({ destination: 'FCO', price: 400, priceStatus: 'INDICATIVE' }),
    ]);
    expect(c!.destination).toBe('MXP');
    expect(pickControlCriteria(plan, cands, [])).toBeNull();
  });

  it('reports the discrepancy; failure is reported, not thrown', () => {
    const primary = [offer({ price: 1000 })];
    expect(compareControl('serpapi', crit, primary, { ok: true, value: [offer({ provider: 'serpapi', price: 950 })] }))
      .toMatchObject({ status: 'OK', primaryPrice: 1000, controlPrice: 950, diffPct: -5 });
    expect(compareControl('serpapi', crit, primary, { ok: true, value: [] })).toMatchObject({ status: 'NO_RESULTS', controlPrice: null });
    expect(compareControl('serpapi', crit, primary, { ok: false, error: 'HTTP 503' })).toMatchObject({ status: 'FAILED', error: 'HTTP 503' });
  });
});
