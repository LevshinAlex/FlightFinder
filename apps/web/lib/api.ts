export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? res.statusText;
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/register')) {
      location.href = '/login';
    }
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const SYMBOL: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };
export function money(v: number | null | undefined, cur: string, locale = 'ru') {
  if (v == null) return '—';
  const n = new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 }).format(v);
  return SYMBOL[cur] ? `${SYMBOL[cur]}${n}` : `${n} ${cur}`;
}

export function fmtDate(iso: string, locale = 'ru', opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: iso.length === 10 ? 'UTC' : undefined, ...opts });
}

export function fmtDateTime(iso: string | Date, locale = 'ru') {
  return new Date(iso).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dateRange(a: string, b: string, locale = 'ru') {
  return `${fmtDate(a, locale)} – ${fmtDate(b, locale)}`;
}

export type Country = { code: string; flag: string; name: { en: string; ru: string }; airports: { iata: string; name: string; city: { en: string; ru: string } }[] };

let countriesCache: Promise<Country[]> | null = null;
export const getCountries = () => (countriesCache ??= api<Country[]>('/airports/countries'));
