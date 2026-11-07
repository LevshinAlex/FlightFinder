/** Date-only helpers. All "dates" are ISO strings YYYY-MM-DD, interpreted in UTC. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}
export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
