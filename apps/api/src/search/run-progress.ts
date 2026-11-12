import { ProviderOffer } from '../providers/flight-provider.interface';
import { cheapestPerRoute, filterOffers } from './search-planner';

/**
 * "Lazy" results: what a running search has found so far. The worker publishes it (shared cache, so the
 * API process sees it) while the search goes on; the tracker page shows it until the final result is stored.
 */
export interface RunProgress {
  /** stage running now: indicative prices → live check → control check */
  stage: 'indicative' | 'live' | 'control';
  /** provider calls of this stage answered so far (failed / timed out ones included) */
  done: number;
  total: number;
  /** cheapest offer per route so far, cheapest first – filtered like the final result */
  offers: ProviderOffer[];
  updatedAt: string;
}

export const PROGRESS_OFFERS = 15;
/** at most one publish per run this often; every stage start / end is always published */
export const PROGRESS_INTERVAL_MS = 1500;
export const PROGRESS_TTL_MIN = 60;

export const progressKey = (runId: string) => `ff:progress:${runId}`;

/** The offers found so far, as the final result would keep them (stops, currency, no calendar-only prices). */
export function partialOffers(offers: ProviderOffer[], maxStops: number, currency: string, limit = PROGRESS_OFFERS): ProviderOffer[] {
  const usable = filterOffers(offers.filter((o) => !o.rankingOnly), maxStops, currency);
  return [...cheapestPerRoute(usable).values()].sort((a, b) => a.price - b.price).slice(0, limit);
}
