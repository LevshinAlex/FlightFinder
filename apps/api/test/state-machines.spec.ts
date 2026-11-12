/**
 * Rules of the implicit state machines made explicit: search-run staleness,
 * the "trip dates passed" tracker state and edge-triggered price alerts.
 */
import { analyzePrices, CheapestPoint, shouldSendPriceAlert } from '../src/analysis/price-analysis';
import { parseIsoDate } from '../src/common/dates';
import { hasSearchableDates, TrackerDates } from '../src/search/date-combinations';
import { activeRunWhere, STALE_RUN_MINUTES, staleCutoff } from '../src/search/run-state';

const tracker = (dep: string, ret: string, p: Partial<TrackerDates> = {}): TrackerDates => ({
  departureDate: parseIsoDate(dep), departureFlexDays: 2, departureFlexMode: 'PLUS',
  returnDate: parseIsoDate(ret), returnFlexDays: 2, returnFlexMode: 'MINUS', ...p,
});

describe('tracker state "trip dates passed"', () => {
  it('is searchable while at least one departure option is today or later', () => {
    expect(hasSearchableDates(tracker('2027-05-10', '2027-05-20'), '2027-05-12')).toBe(true); // +2 → 12 May still open
  });
  it('is not searchable once every departure option is past – even though the return date is not', () => {
    expect(hasSearchableDates(tracker('2027-05-10', '2027-05-20'), '2027-05-13')).toBe(false);
  });
  it('MINUS / BOTH flex never reaches beyond the departure date', () => {
    expect(hasSearchableDates(tracker('2027-05-10', '2027-05-20', { departureFlexMode: 'MINUS' }), '2027-05-11')).toBe(false);
    expect(hasSearchableDates(tracker('2027-05-10', '2027-05-20', { departureFlexMode: 'BOTH' }), '2027-05-12')).toBe(true);
  });
});

describe('search run staleness', () => {
  it('a QUEUED/RUNNING run counts as active only within STALE_RUN_MINUTES', () => {
    const now = new Date('2027-05-10T07:00:00Z');
    expect(staleCutoff(now).getTime()).toBe(now.getTime() - STALE_RUN_MINUTES * 60_000);
    expect(activeRunWhere(now)).toEqual({ status: { in: ['QUEUED', 'RUNNING'] }, startedAt: { gte: staleCutoff(now) } });
  });
});

describe('price alert is edge-triggered', () => {
  const pt = (price: number): CheapestPoint => ({ routeKey: 'TLV-FCO-20270510-20270520', destinationAirport: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20', price, priceStatus: 'LIVE' });
  const analysis = (cur: number, prev: number | null, target: number | null, outcome: 'SUCCESS' | 'FAILED' = 'SUCCESS') =>
    analyzePrices({ outcome, current: pt(cur), previousCheapest: prev == null ? null : pt(prev), previousSameRoutePrice: null, history: [], targetPrice: target, significantChangePct: 2, now: new Date() });

  it('fires when the price crosses below the target', () => {
    expect(shouldSendPriceAlert(analysis(950, 1000, 960), 10, 960)).toBe(true);
  });
  it('fires on the first check that is already below the target', () => {
    expect(shouldSendPriceAlert(analysis(950, null, 960), 10, 960)).toBe(true);
  });
  it('does not fire again every morning while the price stays below the target', () => {
    expect(shouldSendPriceAlert(analysis(940, 950, 960), 10, 960)).toBe(false);
  });
  it('fires on a significant drop regardless of the target', () => {
    expect(shouldSendPriceAlert(analysis(850, 1000, null), 10, null)).toBe(true);
    expect(shouldSendPriceAlert(analysis(950, 1000, null), 10, null)).toBe(false);
  });
  it('never fires for a failed run', () => {
    expect(shouldSendPriceAlert(analysis(500, 1000, 960, 'FAILED'), 10, 960)).toBe(false);
  });
  it('never fires on a cached / approximate (INDICATIVE) price – that fare may no longer exist', () => {
    const a = analyzePrices({ outcome: 'SUCCESS', current: { ...pt(500), priceStatus: 'INDICATIVE' }, previousCheapest: pt(1000), previousSameRoutePrice: null, history: [], targetPrice: 960, significantChangePct: 2, now: new Date() });
    expect(shouldSendPriceAlert(a, 10, 960)).toBe(false);
  });
  it('fires once when Google starts rating the price "low", not while it stays low', () => {
    const withLevel = (cur: string | null, prev: string | null) => analyzePrices({
      outcome: 'SUCCESS', current: { ...pt(990), priceLevel: cur as any }, previousCheapest: { ...pt(1000), priceLevel: prev as any },
      previousSameRoutePrice: null, history: [], targetPrice: null, significantChangePct: 2, now: new Date(),
    });
    expect(shouldSendPriceAlert(withLevel('low', 'typical'), 10, null)).toBe(true);
    expect(shouldSendPriceAlert(withLevel('low', 'low'), 10, null)).toBe(false);
    expect(shouldSendPriceAlert(withLevel('typical', null), 10, null)).toBe(false);
  });
});
