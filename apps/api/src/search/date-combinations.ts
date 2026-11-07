import { addDays } from '../common/dates';

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
