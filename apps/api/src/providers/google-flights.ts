import { FlightSegment, ProviderOffer, SearchCriteria } from './flight-provider.interface';

/** Shared helpers for Google Flights scrapers (SerpApi, HasData). */

/** Public Google Flights search page for the route – used as the booking/search link. */
export function googleFlightsUrl(origin: string, destination: string, departureDate: string, returnDate: string, currency: string): string {
  const q = `Flights from ${origin} to ${destination} on ${departureDate} through ${returnDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&curr=${encodeURIComponent(currency)}`;
}

const SELF_TRANSFER = /self[\s-]?transfer|separate tickets/i;

/** Google marks itineraries built from separate tickets in free-text extensions. */
export function looksSelfTransfer(item: any): boolean {
  const texts: string[] = [
    ...(item?.extensions ?? []),
    ...(item?.flights ?? []).flatMap((f: any) => f?.extensions ?? []),
  ].filter((x) => typeof x === 'string');
  return texts.some((t) => SELF_TRANSFER.test(t));
}

/**
 * Maps one Google Flights leg list to segments.
 * Field names differ only by case between SerpApi (snake_case) and HasData (camelCase).
 */
export function mapLegs(flights: any[]): FlightSegment[] {
  return (flights ?? []).map((f) => {
    const dep = f.departure_airport ?? f.departureAirport ?? {};
    const arr = f.arrival_airport ?? f.arrivalAirport ?? {};
    return {
      from: dep.id, to: arr.id,
      departAt: dep.time, arriveAt: arr.time,
      carrier: f.airline,
      flightNumber: (f.flight_number ?? f.flightNumber)?.replace(/\s+/g, ''),
    };
  });
}

const items = (json: any): any[] => [
  ...(json?.best_flights ?? json?.bestFlights ?? []),
  ...(json?.other_flights ?? json?.otherFlights ?? []),
];
const num = (v: any): number | undefined => (v == null || isNaN(Number(v)) ? undefined : Number(v));

/**
 * Google Flights round trips are two-step: the first page lists OUTBOUND legs (price = cheapest
 * round-trip total starting with that leg); the return legs of one outbound come from a second
 * request with its departure token. We resolve only the cheapest outbound – so every offer we
 * return has real inbound segments and stops (nothing is guessed), at a cost of 2 requests.
 *
 * `fetchPage(token?)` performs one request (with `departure_token` when given).
 */
export async function resolveGoogleRoundTrip(
  provider: string,
  c: SearchCriteria,
  fetchPage: (departureToken?: string) => Promise<any>,
): Promise<ProviderOffer[]> {
  const outbound = items(await fetchPage())
    .filter((i) => num(i.price) !== undefined && (i.departure_token ?? i.departureToken))
    .filter((i) => (i.flights?.length ?? 1) - 1 <= c.maxStops)
    .sort((a, b) => Number(a.price) - Number(b.price));
  const out = outbound[0];
  if (!out) return [];

  const returns = items(await fetchPage(out.departure_token ?? out.departureToken));
  const outSegs = mapLegs(out.flights);
  const observedAt = new Date().toISOString();
  const link = googleFlightsUrl(c.origin, c.destination, c.departureDate, c.returnDate, c.currency);

  return returns
    .filter((r) => num(r.price) !== undefined)
    .map((r): ProviderOffer => {
      const inSegs = mapLegs(r.flights);
      return {
        provider,
        origin: outSegs[0]?.from ?? c.origin,
        destination: outSegs[outSegs.length - 1]?.to ?? c.destination,
        departureDate: c.departureDate,
        returnDate: c.returnDate,
        airline: [...new Set([...outSegs, ...inSegs].map((s) => s.carrier).filter(Boolean))].join(', ') || undefined,
        outboundStops: Math.max(0, outSegs.length - 1),
        inboundStops: Math.max(0, inSegs.length - 1),
        outboundDurationMin: num(out.total_duration ?? out.totalDuration),
        inboundDurationMin: num(r.total_duration ?? r.totalDuration),
        segments: { outbound: outSegs, inbound: inSegs },
        // On the return page Google shows the total round-trip price for all passengers
        price: Number(r.price),
        currency: c.currency.toUpperCase(),
        selfTransfer: looksSelfTransfer(out) || looksSelfTransfer(r),
        bookingUrl: link,
        // Scraped from Google Flights at request time – a current fare, but not a bookable confirmation
        priceStatus: 'LIVE',
        observedAt,
      };
    });
}

/**
 * Offers from the FIRST page only (1 request): real outbound legs + Google's "from" round-trip
 * price, but no return legs. `rankingOnly` – inbound stops are unknown, so these are never stored;
 * used by the provider probe to check coverage and prices on a 1-request budget.
 */
export function outboundOnlyOffers(provider: string, c: SearchCriteria, json: any): ProviderOffer[] {
  const observedAt = new Date().toISOString();
  return items(json)
    .filter((i) => num(i.price) !== undefined)
    .map((i): ProviderOffer => {
      const outSegs = mapLegs(i.flights);
      return {
        provider,
        origin: outSegs[0]?.from ?? c.origin,
        destination: outSegs[outSegs.length - 1]?.to ?? c.destination,
        departureDate: c.departureDate,
        returnDate: c.returnDate,
        airline: [...new Set(outSegs.map((s) => s.carrier).filter(Boolean))].join(', ') || undefined,
        outboundStops: Math.max(0, outSegs.length - 1),
        inboundStops: 0, // unknown (needs the return page) – offer is rankingOnly
        outboundDurationMin: num(i.total_duration ?? i.totalDuration),
        segments: { outbound: outSegs, inbound: [] },
        price: Number(i.price),
        currency: c.currency.toUpperCase(),
        selfTransfer: looksSelfTransfer(i),
        priceStatus: 'LIVE',
        rankingOnly: true,
        observedAt,
      };
    });
}
