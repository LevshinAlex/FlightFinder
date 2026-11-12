import { addDays, toIsoDate } from '../common/dates';

export type FlexMode = 'PLUS' | 'MINUS' | 'BOTH';

export interface DateFlex {
  date: string; // YYYY-MM-DD
  flexDays: number;
  mode: FlexMode;
}

export interface DateCombination {
  departureDate: string;
  returnDate: string;
}

/** Expands one date with its flexibility into the list of candidate dates (sorted). */
export function expandDate({ date, flexDays, mode }: DateFlex): string[] {
  const n = Math.max(0, Math.floor(flexDays));
  const from = mode === 'PLUS' ? 0 : -n;
  const to = mode === 'MINUS' ? 0 : n;
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(addDays(date, i));
  return out;
}

/**
 * Builds all valid departure/return combinations.
 * Example (spec 3.2): 10.05 +2 / 20.05 −2 → 3 × 3 = 9 combinations.
 * Symmetric ±2 on both → up to 25 combinations.
 * Combinations where return is not later than departure are dropped,
 * as are departures in the past (relative to `today`).
 */
export function buildDateCombinations(
  departure: DateFlex,
  ret: DateFlex,
  today?: string,
): DateCombination[] {
  const deps = expandDate(departure).filter((d) => !today || d >= today);
  const rets = expandDate(ret);
  const combos: DateCombination[] = [];
  for (const departureDate of deps) {
    for (const returnDate of rets) {
      if (returnDate > departureDate) combos.push({ departureDate, returnDate });
    }
  }
  return combos;
}

export interface TrackerDates {
  departureDate: Date; departureFlexDays: number; departureFlexMode: FlexMode;
  returnDate: Date; returnFlexDays: number; returnFlexMode: FlexMode;
}

/** The date combinations a stored tracker can still be searched for, as of `today` (UTC, YYYY-MM-DD). */
export function trackerDateCombinations(t: TrackerDates, today = toIsoDate(new Date())): DateCombination[] {
  return buildDateCombinations(
    { date: toIsoDate(t.departureDate), flexDays: t.departureFlexDays, mode: t.departureFlexMode },
    { date: toIsoDate(t.returnDate), flexDays: t.returnFlexDays, mode: t.returnFlexMode },
    today,
  );
}

/**
 * Implicit tracker state "trip dates passed": every departure option is in the past, so there is
 * nothing left to search. Such a tracker is never searched, reported or offered a manual check –
 * a search would only produce a misleading "provider unavailable" failure.
 */
export function hasSearchableDates(t: TrackerDates, today = toIsoDate(new Date())): boolean {
  return trackerDateCombinations(t, today).length > 0;
}
