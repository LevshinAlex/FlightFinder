/**
 * Pure planning / filtering logic of the search engine. No I/O – unit-tested.
 */
import { CabinClass, ProviderOffer, SearchCriteria } from '../providers/flight-provider.interface';
import { DateCombination } from './date-combinations';
import { routeKey } from './route-key';

export interface TrackerSearchPlan {
  trackerId: string;
  origin: string;
  destinations: string[];
  combinations: DateCombination[];
  adults: number;
  cabinClass: CabinClass;
  currency: string;
  maxStops: number;
}

/**
 * Key of an indicative lookup: one airport pair & one date pair. Includes maxStops because some
 * providers filter stops server-side (calendar prices carry no itinerary to filter afterwards).
 */
export function indicativeKey(p: Pick<TrackerSearchPlan, 'origin' | 'adults' | 'cabinClass' | 'currency' | 'maxStops'>, destination: string, c: DateCombination): string {
  return [p.origin, destination, c.departureDate, c.returnDate, p.adults, p.cabinClass, p.currency, p.maxStops].join('|');
}

export function liveKey(c: SearchCriteria): string {
  return [c.origin, c.destination, c.departureDate, c.returnDate, c.adults, c.cabinClass, c.currency, c.maxStops].join('|');
}

export function allCriteria(plan: TrackerSearchPlan): SearchCriteria[] {
  const out: SearchCriteria[] = [];
  for (const destination of plan.destinations)
    for (const c of plan.combinations)
      out.push({ origin: plan.origin, destination, ...c, adults: plan.adults, cabinClass: plan.cabinClass, currency: plan.currency, maxStops: plan.maxStops });
  return out;
}

/**
 * User criteria filter (spec 3.4): max stops applies to EACH direction separately;
 * self-transfer itineraries are excluded in MVP; currency must match; return after departure.
 */
export function filterOffers(offers: ProviderOffer[], maxStops: number, currency: string): ProviderOffer[] {
  return offers.filter(
    (o) =>
      o.outboundStops <= maxStops &&
      o.inboundStops <= maxStops &&
      !o.selfTransfer &&
      o.currency.toUpperCase() === currency.toUpperCase() &&
      o.returnDate > o.departureDate &&
      Number.isFinite(o.price) && o.price > 0,
  );
}

export function offerRouteKey(o: ProviderOffer): string {
  return routeKey(o.origin, o.destination, o.departureDate, o.returnDate);
}

/** Cheapest offer per route (airport + dates). LIVE offers always win over INDICATIVE for the same route. */
export function cheapestPerRoute(offers: ProviderOffer[]): Map<string, ProviderOffer> {
  const best = new Map<string, ProviderOffer>();
  for (const o of offers) {
    const k = offerRouteKey(o);
    const cur = best.get(k);
    if (!cur) { best.set(k, o); continue; }
    const curLive = cur.priceStatus === 'LIVE', oLive = o.priceStatus === 'LIVE';
    if ((oLive && !curLive) || (oLive === curLive && o.price < cur.price)) best.set(k, o);
  }
  return best;
}

/**
 * Stage 2 selection: top-N cheapest indicative combinations PLUS quality control –
 * the cheapest combo of every airport and one probe for airports without any
 * indicative data (indicative caches are incomplete).
 * `airportProbes: false` keeps only the top-N – a fixed, predictable live budget per tracker.
 */
export function selectLiveCandidates(plan: TrackerSearchPlan, indicative: ProviderOffer[], topN: number, airportProbes = true): SearchCriteria[] {
  const criteria = allCriteria(plan);
  const byKey = new Map(criteria.map((c) => [`${c.destination}|${c.departureDate}|${c.returnDate}`, c]));
  const ranked = [...cheapestPerRoute(filterOffers(indicative, plan.maxStops, plan.currency)).values()].sort((a, b) => a.price - b.price);

  const chosen = new Map<string, SearchCriteria>();
  const pick = (dest: string, dep: string, ret: string) => {
    const k = `${dest}|${dep}|${ret}`;
    const c = byKey.get(k);
    if (c) chosen.set(k, c);
  };

  ranked.slice(0, topN).forEach((o) => pick(o.destination, o.departureDate, o.returnDate));
  if (!airportProbes) {
    // no usable indicative data at all: still check something – middle dates of the first airports
    if (!chosen.size) {
      const mid = plan.combinations[Math.floor(plan.combinations.length / 2)];
      if (mid) for (const d of plan.destinations.slice(0, topN)) pick(d, mid.departureDate, mid.returnDate);
    }
    return [...chosen.values()];
  }

  const seenAirports = new Set<string>();
  for (const o of ranked) {
    if (seenAirports.has(o.destination)) continue;
    seenAirports.add(o.destination);
    pick(o.destination, o.departureDate, o.returnDate);
  }
  const mid = plan.combinations[Math.floor(plan.combinations.length / 2)];
  if (mid) for (const d of plan.destinations) if (!seenAirports.has(d)) pick(d, mid.departureDate, mid.returnDate);

  return [...chosen.values()];
}

export type Outcome = 'SUCCESS' | 'PARTIAL' | 'NO_RESULTS' | 'FAILED';

/**
 * Distinguishes "no flights found" from "provider failed" (spec 6, test #8).
 */
export function determineOutcome(callsTotal: number, callsFailed: number, offersFound: number): Outcome {
  if (callsTotal === 0) return 'FAILED';
  if (offersFound === 0) return callsFailed > 0 ? 'FAILED' : 'NO_RESULTS';
  return callsFailed > 0 ? 'PARTIAL' : 'SUCCESS';
}

/**
 * Control check target: the criteria of the tracker's cheapest usable LIVE result
 * (the price the user would act on). Null when the live stage found nothing.
 */
export function pickControlCriteria(plan: TrackerSearchPlan, candidates: SearchCriteria[], liveOffers: ProviderOffer[]): SearchCriteria | null {
  const best = [...cheapestPerRoute(filterOffers(liveOffers.filter((o) => o.priceStatus === 'LIVE' && !o.rankingOnly), plan.maxStops, plan.currency)).values()]
    .sort((a, b) => a.price - b.price)[0];
  if (!best) return null;
  return candidates.find((c) => c.destination === best.destination && c.departureDate === best.departureDate && c.returnDate === best.returnDate) ?? null;
}

export interface ControlCheck {
  provider: string;
  routeKey: string;
  primaryPrice: number | null;
  controlPrice: number | null;
  /** (control − primary) / primary, %; negative = control source found it cheaper */
  diffPct: number | null;
  status: 'OK' | 'NO_RESULTS' | 'FAILED';
  error?: string;
}

/** Compares the primary and control cheapest price for the same route + criteria. */
export function compareControl(
  provider: string, c: SearchCriteria, primaryOffers: ProviderOffer[],
  control: { ok: true; value: ProviderOffer[] } | { ok: false; error: string },
): ControlCheck {
  const rk = routeKey(c.origin, c.destination, c.departureDate, c.returnDate);
  const cheapest = (offers: ProviderOffer[]) => {
    const prices = filterOffers(offers, c.maxStops, c.currency).filter((o) => offerRouteKey(o) === rk).map((o) => o.price);
    return prices.length ? Math.min(...prices) : null;
  };
  const primaryPrice = cheapest(primaryOffers);
  if (!control.ok) return { provider, routeKey: rk, primaryPrice, controlPrice: null, diffPct: null, status: 'FAILED', error: control.error };
  const controlPrice = cheapest(control.value);
  const diffPct = primaryPrice && controlPrice != null ? Math.round(((controlPrice - primaryPrice) / primaryPrice) * 1000) / 10 : null;
  return { provider, routeKey: rk, primaryPrice, controlPrice, diffPct, status: controlPrice == null ? 'NO_RESULTS' : 'OK' };
}
