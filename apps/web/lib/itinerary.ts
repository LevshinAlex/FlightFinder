/** Itinerary helpers: times as printed on the ticket (local airport time) and layovers. */

export type Segment = { from: string; to: string; departAt?: string; arriveAt?: string; carrier?: string; flightNumber?: string };
export type Places = Record<string, { en: string; ru: string }>;

type Stamp = { date: string; time: string; ms: number; utc: boolean };

/**
 * Parses "2027-07-17 14:30" (Google Flights) or "2027-07-17T14:30:00" / "…Z" (Ignav) WITHOUT
 * converting time zones: the wall clock is shown as is. `ms` is only used for differences between
 * two stamps of the same airport (layovers), so the zone cancels out.
 */
export function parseStamp(s?: string): Stamp | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, ms: Date.UTC(+y, +mo - 1, +d, +h, +mi), utc: /(Z|[+-]00:?00)$/.test(s!) };
}

export type Layover = { airport: string; minutes: number | null };
export type Leg = { depart: Stamp | null; arrive: Stamp | null; layovers: Layover[] };

export function leg(segments?: Segment[]): Leg | null {
  if (!segments?.length) return null;
  const layovers: Layover[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const arr = parseStamp(segments[i].arriveAt);
    const dep = parseStamp(segments[i + 1].departAt);
    const minutes = arr && dep && arr.utc === dep.utc ? Math.round((dep.ms - arr.ms) / 60000) : null;
    layovers.push({ airport: segments[i].to, minutes: minutes != null && minutes >= 0 ? minutes : null });
  }
  return { depart: parseStamp(segments[0].departAt), arrive: parseStamp(segments[segments.length - 1].arriveAt), layovers };
}

export function fmtStamp(s: Stamp, locale = 'ru', withDate = true) {
  const date = new Date(`${s.date}T00:00:00Z`).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return `${withDate ? `${date}, ` : ''}${s.time}${s.utc ? ' UTC' : ''}`;
}

export function fmtWait(min: number, locale = 'ru') {
  const h = Math.floor(min / 60), m = min % 60;
  const [hh, mm] = locale === 'ru' ? ['ч', 'мин'] : ['h', 'min'];
  return h ? `${h} ${hh}${m ? ` ${m} ${mm}` : ''}` : `${m} ${mm}`;
}

/** "+1" when the trip arrives on a later calendar day than it departs. */
export function dayShift(l: Leg): number {
  if (!l.depart || !l.arrive) return 0;
  return Math.round((Date.parse(`${l.arrive.date}T00:00:00Z`) - Date.parse(`${l.depart.date}T00:00:00Z`)) / 86400e3);
}
