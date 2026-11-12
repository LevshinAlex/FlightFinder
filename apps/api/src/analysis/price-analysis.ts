/**
 * Pure price-trend analysis (spec section 6). No DB access – easy to unit-test.
 */

export type ChangeStatus =
  | 'PRICE_DROPPED'
  | 'PRICE_INCREASED'
  | 'NO_SIGNIFICANT_CHANGE'
  | 'FIRST_CHECK'
  | 'NOT_COMPARABLE'; // previous run failed / no data – never claim a change

export type RunOutcome = 'SUCCESS' | 'PARTIAL' | 'NO_RESULTS' | 'FAILED';

export interface CheapestPoint {
  routeKey: string;
  destinationAirport: string;
  departureDate: string;
  returnDate: string;
  price: number;
  priceStatus: 'LIVE' | 'INDICATIVE';
  /** Google Flights' rating of this price and its usual range (only Google-based providers) */
  priceLevel?: PriceLevel | null;
  typicalRange?: [number, number] | null;
}

export type PriceLevel = 'low' | 'typical' | 'high';

export interface HistoryPoint {
  price: number;
  recordedAt: Date;
  priceStatus: 'LIVE' | 'INDICATIVE';
}

export interface AnalysisInput {
  outcome: RunOutcome;
  current: CheapestPoint | null;
  /** cheapest of the previous successful run (country level) */
  previousCheapest: CheapestPoint | null;
  /** previous price of the SAME routeKey as today's cheapest (route level) */
  previousSameRoutePrice: number | null;
  /** all snapshot points of this tracker before the current run */
  history: HistoryPoint[];
  targetPrice: number | null;
  significantChangePct: number;
  now: Date;
}

export interface PriceAnalysis {
  outcome: RunOutcome;
  currentMinPrice: number | null;
  currentPriceStatus: 'LIVE' | 'INDICATIVE' | null;
  previousPrice: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  status: ChangeStatus;
  /** route-level comparison (same airport & dates) */
  sameRoute: { previousPrice: number | null; change: number | null; changePct: number | null; status: ChangeStatus };
  /** true when the cheapest option moved to a different airport/dates */
  cheapestRouteChanged: boolean;
  previousBestDestination: string | null;
  bestDestination: string | null;
  min7d: number | null;
  min30d: number | null;
  historicalMin: number | null;
  isNewHistoricalLow: boolean;
  targetReached: boolean;
  /** Google's rating of today's / the previous cheapest price, and today's usual range */
  priceLevel: PriceLevel | null;
  previousPriceLevel: PriceLevel | null;
  typicalRange: [number, number] | null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Price Change % = (Current − Previous) / Previous × 100, rounded once to 0.1 */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function classifyChange(pct: number, thresholdPct: number): ChangeStatus {
  if (Math.abs(pct) < thresholdPct) return 'NO_SIGNIFICANT_CHANGE';
  return pct < 0 ? 'PRICE_DROPPED' : 'PRICE_INCREASED';
}

function minSince(history: HistoryPoint[], since: Date | null, extra: number | null): number | null {
  const prices = history.filter((h) => !since || h.recordedAt >= since).map((h) => h.price);
  if (extra != null) prices.push(extra);
  return prices.length ? Math.min(...prices) : null;
}

export function analyzePrices(input: AnalysisInput): PriceAnalysis {
  const { outcome, current, previousCheapest, history, now } = input;
  const day = 24 * 3600 * 1000;
  const cur = current?.price ?? null;

  const base: PriceAnalysis = {
    outcome,
    currentMinPrice: cur,
    currentPriceStatus: current?.priceStatus ?? null,
    previousPrice: previousCheapest?.price ?? null,
    priceChange: null,
    priceChangePct: null,
    status: 'NOT_COMPARABLE',
    sameRoute: { previousPrice: input.previousSameRoutePrice, change: null, changePct: null, status: 'NOT_COMPARABLE' },
    cheapestRouteChanged: false,
    previousBestDestination: previousCheapest?.destinationAirport ?? null,
    bestDestination: current?.destinationAirport ?? null,
    min7d: minSince(history, new Date(now.getTime() - 7 * day), cur),
    min30d: minSince(history, new Date(now.getTime() - 30 * day), cur),
    historicalMin: minSince(history, null, cur),
    isNewHistoricalLow: false,
    targetReached: false,
    priceLevel: current?.priceLevel ?? null,
    previousPriceLevel: previousCheapest?.priceLevel ?? null,
    typicalRange: current?.typicalRange ?? null,
  };

  // Test #8: on API failure or empty result we never report an increase / decrease.
  if ((outcome !== 'SUCCESS' && outcome !== 'PARTIAL') || cur == null) return base;

  const histMinBefore = history.length ? Math.min(...history.map((h) => h.price)) : null;
  base.isNewHistoricalLow = histMinBefore != null && cur < histMinBefore;
  base.targetReached = input.targetPrice != null && cur <= input.targetPrice;

  if (!previousCheapest) {
    base.status = 'FIRST_CHECK';
  } else {
    base.priceChange = round2(cur - previousCheapest.price);
    base.priceChangePct = percentChange(cur, previousCheapest.price);
    base.status = classifyChange(base.priceChangePct, input.significantChangePct);
    base.cheapestRouteChanged = previousCheapest.routeKey !== current!.routeKey;
  }

  if (input.previousSameRoutePrice != null) {
    const p = input.previousSameRoutePrice;
    const pct = percentChange(cur, p);
    base.sameRoute = { previousPrice: p, change: round2(cur - p), changePct: pct, status: classifyChange(pct, input.significantChangePct) };
  }
  return base;
}

/**
 * Extra alert (spec 8.3), edge-triggered: a significant drop since the previous check, the price
 * crossing below the target, or Google starting to rate it "low". Staying there is shown in the
 * daily summary – it does not trigger a new alert every morning.
 * Only a LIVE price can alert: a cached / approximate one may no longer exist.
 */
export function shouldSendPriceAlert(a: PriceAnalysis, dropAlertPct: number, targetPrice: number | null): boolean {
  if (a.outcome !== 'SUCCESS' && a.outcome !== 'PARTIAL') return false;
  if (a.currentPriceStatus !== 'LIVE') return false;
  const bigDrop = a.priceChangePct != null && a.priceChangePct <= -dropAlertPct;
  const crossedTarget = a.targetReached && (a.previousPrice == null || targetPrice == null || a.previousPrice > targetPrice);
  const turnedLow = a.priceLevel === 'low' && a.previousPriceLevel !== 'low';
  return bigDrop || crossedTarget || turnedLow;
}
