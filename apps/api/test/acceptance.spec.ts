/**
 * Unit-level acceptance tests mapped to spec section 15.
 */
import { analyzePrices, percentChange } from '../src/analysis/price-analysis';
import { AirportsService } from '../src/airports/airports.service';
import { buildDateCombinations } from '../src/search/date-combinations';
import { determineOutcome, filterOffers, selectLiveCandidates, TrackerSearchPlan } from '../src/search/search-planner';
import { ProviderOffer } from '../src/providers/flight-provider.interface';
import { buildDailyReport } from '../src/notifications/report-builder';

const offer = (p: Partial<ProviderOffer>): ProviderOffer => ({
  provider: 'test', origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
  outboundStops: 0, inboundStops: 0, price: 1000, currency: 'ILS', priceStatus: 'LIVE', observedAt: new Date().toISOString(), ...p,
});

describe('Test #1 – flexible dates', () => {
  it('10 May +2 / 20 May −2 → 9 correct combinations', () => {
    const c = buildDateCombinations({ date: '2027-05-10', flexDays: 2, mode: 'PLUS' }, { date: '2027-05-20', flexDays: 2, mode: 'MINUS' });
    expect(c).toHaveLength(9);
    expect([...new Set(c.map((x) => x.departureDate))]).toEqual(['2027-05-10', '2027-05-11', '2027-05-12']);
    expect([...new Set(c.map((x) => x.returnDate))]).toEqual(['2027-05-18', '2027-05-19', '2027-05-20']);
  });
  it('symmetric ±2 → 25 combinations', () => {
    expect(buildDateCombinations({ date: '2027-05-10', flexDays: 2, mode: 'BOTH' }, { date: '2027-05-20', flexDays: 2, mode: 'BOTH' })).toHaveLength(25);
  });
  it('drops combinations where return is not after departure', () => {
    const c = buildDateCombinations({ date: '2027-05-10', flexDays: 2, mode: 'BOTH' }, { date: '2027-05-11', flexDays: 2, mode: 'BOTH' });
    expect(c.every((x) => x.returnDate > x.departureDate)).toBe(true);
    expect(c.length).toBeLessThan(25);
  });
  it('drops past departure dates', () => {
    const c = buildDateCombinations({ date: '2027-05-10', flexDays: 2, mode: 'BOTH' }, { date: '2027-05-20', flexDays: 0, mode: 'PLUS' }, '2027-05-10');
    expect(c.map((x) => x.departureDate)).toEqual(['2027-05-10', '2027-05-11', '2027-05-12']);
  });
});

describe('Test #2 – search by country', () => {
  it('Italy resolves to several airports, not only the capital', () => {
    const airports = new AirportsService().resolveDestinationAirports('IT', []);
    expect(airports.length).toBeGreaterThan(5);
    expect(airports).toEqual(expect.arrayContaining(['FCO', 'MXP', 'VCE', 'NAP', 'BLQ']));
  });
  it('live candidates cover every airport (quality control for incomplete indicative cache)', () => {
    const plan: TrackerSearchPlan = {
      trackerId: 't', origin: 'TLV', destinations: ['FCO', 'MXP', 'NAP'], adults: 1, cabinClass: 'ECONOMY', currency: 'ILS', maxStops: 1,
      combinations: buildDateCombinations({ date: '2027-05-10', flexDays: 2, mode: 'PLUS' }, { date: '2027-05-20', flexDays: 2, mode: 'MINUS' }),
    };
    const ind = [offer({ destination: 'FCO', price: 500, priceStatus: 'INDICATIVE' }), offer({ destination: 'FCO', departureDate: '2027-05-11', price: 600, priceStatus: 'INDICATIVE' })];
    const cands = selectLiveCandidates(plan, ind, 1);
    expect(new Set(cands.map((c) => c.destination))).toEqual(new Set(['FCO', 'MXP', 'NAP']));
  });
});

describe('Test #3 – stops', () => {
  it('max 1 stop excludes offers with 2 stops in ANY direction', () => {
    const res = filterOffers([
      offer({ outboundStops: 1, inboundStops: 1 }),
      offer({ outboundStops: 2, inboundStops: 0 }),
      offer({ outboundStops: 0, inboundStops: 2 }),
      offer({ outboundStops: 0, inboundStops: 0 }),
    ], 1, 'ILS');
    expect(res).toHaveLength(2);
    expect(res.every((o) => o.outboundStops <= 1 && o.inboundStops <= 1)).toBe(true);
  });
  it('excludes self-transfer itineraries and other currencies', () => {
    expect(filterOffers([offer({ selfTransfer: true }), offer({ currency: 'EUR' })], 1, 'ILS')).toHaveLength(0);
  });
});

const point = (price: number, routeKey = 'TLV-FCO-20270510-20270520', destinationAirport = 'FCO') =>
  ({ routeKey, destinationAirport, departureDate: '2027-05-10', returnDate: '2027-05-20', price, priceStatus: 'LIVE' as const });

describe('Test #5 – trend', () => {
  it('₪1,000 → ₪900 is a 10% decrease', () => {
    expect(percentChange(900, 1000)).toBe(-10);
    const a = analyzePrices({
      outcome: 'SUCCESS', current: point(900), previousCheapest: point(1000), previousSameRoutePrice: 1000,
      history: [{ price: 1000, recordedAt: new Date(), priceStatus: 'LIVE' }], targetPrice: 950, significantChangePct: 2, now: new Date(),
    });
    expect(a.priceChange).toBe(-100);
    expect(a.priceChangePct).toBe(-10);
    expect(a.status).toBe('PRICE_DROPPED');
    expect(a.isNewHistoricalLow).toBe(true);
    expect(a.targetReached).toBe(true);
  });
  it('change below threshold is "no significant change"', () => {
    const a = analyzePrices({ outcome: 'SUCCESS', current: point(1010), previousCheapest: point(1000), previousSameRoutePrice: null, history: [], targetPrice: null, significantChangePct: 2, now: new Date() });
    expect(a.status).toBe('NO_SIGNIFICANT_CHANGE');
  });
  it('cheapest moved from Milan to Rome is reported as a destination change', () => {
    const a = analyzePrices({
      outcome: 'SUCCESS', current: point(900, 'TLV-FCO-x', 'FCO'), previousCheapest: point(1000, 'TLV-MXP-x', 'MXP'),
      previousSameRoutePrice: 950, history: [], targetPrice: null, significantChangePct: 2, now: new Date(),
    });
    expect(a.cheapestRouteChanged).toBe(true);
    expect(a.previousBestDestination).toBe('MXP');
    expect(a.sameRoute.changePct).toBeCloseTo(-5.26, 1);
  });
  it('7-day / 30-day / historical minimum', () => {
    const now = new Date('2027-04-30T00:00:00Z');
    const d = (days: number) => new Date(now.getTime() - days * 86400e3);
    const a = analyzePrices({
      outcome: 'SUCCESS', current: point(950), previousCheapest: point(1000), previousSameRoutePrice: null, targetPrice: null, significantChangePct: 2, now,
      history: [{ price: 700, recordedAt: d(60), priceStatus: 'LIVE' }, { price: 800, recordedAt: d(20), priceStatus: 'LIVE' }, { price: 900, recordedAt: d(3), priceStatus: 'LIVE' }],
    });
    expect([a.min7d, a.min30d, a.historicalMin]).toEqual([900, 800, 700]);
  });
});

describe('Test #8 – provider errors', () => {
  it('failed provider calls are FAILED, not NO_RESULTS', () => {
    expect(determineOutcome(9, 9, 0)).toBe('FAILED');
    expect(determineOutcome(9, 0, 0)).toBe('NO_RESULTS');
    expect(determineOutcome(9, 3, 5)).toBe('PARTIAL');
    expect(determineOutcome(9, 0, 5)).toBe('SUCCESS');
  });
  it('analysis never claims an increase or "no flights" when API failed', () => {
    const a = analyzePrices({ outcome: 'FAILED', current: null, previousCheapest: point(900), previousSameRoutePrice: null, history: [], targetPrice: null, significantChangePct: 2, now: new Date() });
    expect(a.status).toBe('NOT_COMPARABLE');
    expect(a.priceChangePct).toBeNull();
    const r = buildDailyReport([{ trackerId: 't', title: '🇮🇹 ITALY', currency: 'ILS', analysis: a, runStatus: 'FAILED', detailsUrl: 'x' }], '2027-04-15', 'en');
    expect(r.text).toMatch(/check failed/i);
    expect(r.text).not.toMatch(/increased by/i);
    expect(r.text).not.toMatch(/No flights matching/i);
  });
});

describe('Test #6 / #10 – daily report', () => {
  it('one report lists all trackers and flags indicative prices', () => {
    const a1 = analyzePrices({ outcome: 'SUCCESS', current: point(890), previousCheapest: point(1020), previousSameRoutePrice: null, history: [], targetPrice: null, significantChangePct: 2, now: new Date() });
    const a2 = analyzePrices({ outcome: 'SUCCESS', current: { ...point(2450, 'k', 'KIX'), priceStatus: 'INDICATIVE' }, previousCheapest: point(2390, 'k', 'KIX'), previousSameRoutePrice: null, history: [], targetPrice: null, significantChangePct: 2, now: new Date() });
    const r = buildDailyReport([
      { trackerId: '1', title: '🇮🇹 ITALY', currency: 'ILS', analysis: a1, runStatus: 'SUCCESS', detailsUrl: 'x', checkedAt: new Date() },
      { trackerId: '2', title: '🇯🇵 JAPAN', currency: 'ILS', analysis: a2, runStatus: 'SUCCESS', detailsUrl: 'y' },
    ], '2027-04-15', 'en');
    expect(r.text).toContain('ITALY');
    expect(r.text).toContain('JAPAN');
    expect(r.text).toContain('decreased by 12.7%');
    expect(r.text).toContain('increased by 2.5%');
    expect(r.text).toMatch(/Approximate price/);
    expect(r.text).toContain('Lowest price today: ITALY — ₪890');
  });
});
