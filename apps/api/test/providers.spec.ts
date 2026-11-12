/**
 * Free live providers: request shape + response mapping, with fetch mocked (no network).
 */
import { config } from '../src/common/config';
import { SerpApiProvider } from '../src/providers/serpapi.provider';
import { HasDataProvider } from '../src/providers/hasdata.provider';
import { IgnavProvider } from '../src/providers/ignav.provider';
import { ProviderNotSupportedError, ProviderRequestError, SearchCriteria } from '../src/providers/flight-provider.interface';
import { filterOffers } from '../src/search/search-planner';
import { FxRates } from '../src/common/fx';
import { withCurrencyNormalization } from '../src/providers/currency';

const criteria: SearchCriteria = {
  origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
  adults: 2, cabinClass: 'ECONOMY', currency: 'ILS', maxStops: 1,
};

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
const respond = (...bodies: any[]) => {
  calls = [];
  let i = 0;
  global.fetch = jest.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as any;
};

beforeAll(() => {
  config.providers.serpapiKey = 'serp-key';
  config.providers.hasdataKey = 'hd-key';
  config.providers.ignavKey = 'ig-key';
});

// --- Google Flights shaped pages (SerpApi snake_case) ---
const leg = (from: string, to: string, fn: string, airline = 'ITA Airways') => ({
  departure_airport: { id: from, time: '2027-05-10 08:00' }, arrival_airport: { id: to, time: '2027-05-10 11:00' },
  airline, flight_number: fn,
});
const serpOutbound = {
  best_flights: [
    { price: 1500, total_duration: 240, flights: [leg('TLV', 'FCO', 'AZ 811')], departure_token: 'dep-cheap' },
    { price: 1900, total_duration: 300, flights: [leg('TLV', 'ATH', 'A3 929'), leg('ATH', 'FCO', 'A3 650')], departure_token: 'dep-2' },
  ],
  other_flights: [
    { price: 900, flights: [leg('TLV', 'IST', 'TK 1'), leg('IST', 'SOF', 'TK 2'), leg('SOF', 'FCO', 'TK 3')], departure_token: 'dep-too-many-stops' },
  ],
};
const serpReturn = {
  best_flights: [{ price: 1500, total_duration: 250, flights: [leg('FCO', 'TLV', 'AZ 810')] }],
  other_flights: [
    { price: 1700, total_duration: 400, flights: [leg('FCO', 'ATH', 'A3 651'), leg('ATH', 'TLV', 'A3 928')], extensions: ['Self transfer'] },
  ],
};

describe('SerpApi (Google Flights)', () => {
  it('requests the cheapest valid outbound, then its return page; maps real stops on both legs', async () => {
    respond(serpOutbound, serpReturn);
    const offers = await new SerpApiProvider().searchFlights(criteria);

    expect(calls).toHaveLength(2);
    const q1 = new URL(calls[0].url).searchParams;
    expect(q1.get('engine')).toBe('google_flights');
    expect(q1.get('departure_id')).toBe('TLV');
    expect(q1.get('arrival_id')).toBe('FCO');
    expect(q1.get('stops')).toBe('2');          // ≤1 stop
    expect(q1.get('travel_class')).toBe('1');
    expect(q1.get('currency')).toBe('ILS');
    expect(q1.get('adults')).toBe('2');
    // 2-stop outbound (cheaper) is skipped, the 1500 nonstop is resolved
    expect(new URL(calls[1].url).searchParams.get('departure_token')).toBe('dep-cheap');

    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      provider: 'serpapi', origin: 'TLV', destination: 'FCO', price: 1500, currency: 'ILS',
      outboundStops: 0, inboundStops: 0, priceStatus: 'LIVE', selfTransfer: false,
    });
    expect(offers[0].segments?.outbound[0].flightNumber).toBe('AZ811');
    expect(offers[0].bookingUrl).toContain('google.com/travel/flights');
    expect(offers[1]).toMatchObject({ inboundStops: 1, selfTransfer: true });
    // self-transfer is dropped by the engine filter
    expect(filterOffers(offers, 1, 'ILS')).toHaveLength(1);
  });

  it('"no results" error body → empty list (NO_RESULTS), not a failure', async () => {
    respond({ error: "Google Flights hasn't returned any results for this query." });
    await expect(new SerpApiProvider().searchFlights(criteria)).resolves.toEqual([]);
  });

  it('other API errors are surfaced', async () => {
    respond({ error: 'Invalid API key.' });
    await expect(new SerpApiProvider().searchFlights(criteria)).rejects.toBeInstanceOf(ProviderRequestError);
  });
});

describe('HasData (Google Flights)', () => {
  const camel = (l: any) => ({
    departureAirport: l.departure_airport, arrivalAirport: l.arrival_airport, airline: l.airline, flightNumber: l.flight_number,
  });
  it('uses camelCase params + x-api-key, no undocumented stops/travelClass', async () => {
    respond(
      { bestFlights: [{ price: 1600, totalDuration: 240, flights: [camel(leg('TLV', 'FCO', 'AZ 811'))], departureToken: 'hd-dep' }] },
      { bestFlights: [{ price: 1600, totalDuration: 250, flights: [camel(leg('FCO', 'TLV', 'AZ 810'))] }] },
    );
    const offers = await new HasDataProvider().searchFlights(criteria);
    expect(calls).toHaveLength(2);
    const q1 = new URL(calls[0].url).searchParams;
    expect(q1.get('departureId')).toBe('TLV');
    expect(q1.get('type')).toBe('roundTrip');
    expect(q1.has('stops')).toBe(false);
    expect(q1.has('travelClass')).toBe(false);
    expect((calls[0].init?.headers as any)['x-api-key']).toBe('hd-key');
    expect(new URL(calls[1].url).searchParams.get('departureToken')).toBe('hd-dep');
    expect(offers[0]).toMatchObject({ provider: 'hasdata', price: 1600, outboundStops: 0, inboundStops: 0 });
  });

  it('non-economy cabins are explicitly unsupported', async () => {
    respond({});
    await expect(new HasDataProvider().searchFlights({ ...criteria, cabinClass: 'BUSINESS' })).rejects.toBeInstanceOf(ProviderNotSupportedError);
    expect(calls).toHaveLength(0);
  });
});

describe('Ignav', () => {
  const seg = (from: string, to: string, n: string) => ({
    marketing_carrier_code: 'AZ', flight_number: n, operating_carrier_name: 'ITA Airways',
    departure_airport: from, arrival_airport: to, departure_time_utc: '2027-05-10T05:00:00Z', arrival_time_utc: '2027-05-10T09:00:00Z',
  });
  const body = (currency: string, status = 'verified') => ({
    observed_at: '2026-11-07T10:00:00Z',
    itineraries: [{
      price: { amount: 1450, currency, status },
      outbound: { carrier: 'ITA Airways', duration_minutes: 240, segments: [seg('TLV', 'FCO', '811')] },
      inbound: { carrier: 'ITA Airways', duration_minutes: 250, segments: [seg('FCO', 'MXP', '1'), seg('MXP', 'TLV', '2')] },
      ignav_id: 'ig-1',
    }],
  });

  it('posts round-trip body with the configured market (IL); maps both legs', async () => {
    respond(body('ILS'));
    const offers = await new IgnavProvider().searchFlights(criteria);
    expect(calls[0].url).toBe('https://ignav.com/api/fares/round-trip');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      origin: 'TLV', destination: 'FCO', departure_date: '2027-05-10', return_date: '2027-05-20',
      adults: 2, cabin_class: 'economy', max_stops: 1, market: 'IL',
    });
    expect((calls[0].init?.headers as any)['X-Api-Key']).toBe('ig-key');
    expect(offers[0]).toMatchObject({
      provider: 'ignav', providerOfferId: 'ig-1', price: 1450, currency: 'ILS',
      outboundStops: 0, inboundStops: 1, priceStatus: 'LIVE', observedAt: '2026-11-07T10:00:00Z',
    });
  });

  it('non-verified price → INDICATIVE', async () => {
    respond(body('ILS', 'estimated'));
    const [o] = await new IgnavProvider().searchFlights(criteria);
    expect(o.priceStatus).toBe('INDICATIVE');
  });

  it('asks the IL market even for USD; the currency layer converts ILS → USD and keeps the quote', async () => {
    respond(body('ILS'));
    const rates = new FxRates(() => 'unused');
    rates.setRates('USD', { ILS: 4 });
    const [o] = await withCurrencyNormalization(new IgnavProvider(), rates).searchFlights({ ...criteria, currency: 'USD' });
    expect(JSON.parse(String(calls[0].init?.body)).market).toBe('IL');
    expect(o).toMatchObject({ price: 362.5, currency: 'USD', originalPrice: 1450, originalCurrency: 'ILS' });
  });

  it('booking link prefers exact_flight', async () => {
    respond({ booking_options: [{ links: [
      { specificity: 'search_results', url: 'https://x/search' },
      { specificity: 'exact_flight', url: 'https://x/exact' },
    ] }] });
    await expect(new IgnavProvider().getBookingLink('ig-1')).resolves.toBe('https://x/exact');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ ignav_id: 'ig-1' });
  });
});

import { carrierName } from '../src/providers/airlines';

describe('carrier names', () => {
  it('Latin provider names are kept; Hebrew ones replaced from the directory; unknown → code', () => {
    expect(carrierName('LY', 'El Al Israel Airlines')).toBe('El Al Israel Airlines');
    expect(carrierName('LY', 'אל על')).toBe('El Al');
    expect(carrierName('6H', 'ישראייר')).toBe('Israir');
    expect(carrierName('ZZ', 'חברה')).toBe('ZZ');
    expect(carrierName(undefined, undefined)).toBeUndefined();
  });

  it('Ignav market IL: Hebrew carrier names become English in segments and airline', async () => {
    config.providers.ignavKey = 'ig-key';
    const seg = (from: string, to: string, code: string, n: string, name: string) => ({
      marketing_carrier_code: code, flight_number: n, operating_carrier_name: name, departure_airport: from, arrival_airport: to,
    });
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ itineraries: [{
      price: { amount: 884, currency: 'ILS', status: 'verified' },
      outbound: { carrier: 'אל על', segments: [seg('TLV', 'FCO', 'LY', '383', 'אל על')] },
      inbound: { carrier: 'אל על', segments: [seg('FCO', 'TLV', 'LY', '386', 'אל על')] },
    }] }), { status: 200 })) as any;
    const [o] = await new IgnavProvider().searchFlights(criteria);
    expect(o.airline).toBe('El Al');
    expect(o.segments!.outbound[0].carrier).toBe('El Al');
  });
});
