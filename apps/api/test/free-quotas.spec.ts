/**
 * Free API plans: quota budgets, conversion to the base currency (USD), Google price insights, Kiwi adapter.
 */
import { config } from '../src/common/config';
import { FxRates, parseRates } from '../src/common/fx';
import { MemoryStore, parseLimits, ProviderBudget, isQuotaMessage } from '../src/providers/budget';
import { toCurrency } from '../src/providers/currency';
import { ProviderOffer, ProviderQuotaExceededError, SearchCriteria } from '../src/providers/flight-provider.interface';
import { priceInsight } from '../src/providers/google-flights';
import { KiwiProvider } from '../src/providers/kiwi.provider';
import { filterOffers } from '../src/search/search-planner';

const budget = (now: string, limits: Record<string, number>, pacing = true) =>
  new ProviderBudget({ limits, unitsPerRequest: { hasdata: 15 }, pacing, enabled: true, store: new MemoryStore(), now: () => new Date(now) });

describe('provider budgets (free quotas)', () => {
  it('parses PROVIDER_MONTHLY_LIMITS', () => {
    expect(parseLimits('serpapi:250, Kiwi:300,bad,x:')).toEqual({ serpapi: 250, kiwi: 300 });
  });

  it('refuses the request over the monthly limit before it is sent', async () => {
    const b = budget('2026-11-30T10:00:00Z', { kiwi: 3 }); // last day: today may use the whole rest
    for (let i = 0; i < 3; i++) await b.reserve('kiwi');
    await expect(b.reserve('kiwi')).rejects.toThrow(ProviderQuotaExceededError);
    expect(await b.todayLeft('kiwi')).toBe(0);
  });

  it('daily pacing spreads the month: 300/month on the 1st of a 30-day month → 10 today', async () => {
    const b = budget('2026-11-01T08:00:00Z', { kiwi: 300 });
    expect(await b.todayLeft('kiwi')).toBe(10);
    for (let i = 0; i < 10; i++) await b.reserve('kiwi');
    await expect(b.reserve('kiwi')).rejects.toThrow(/today's share/);
  });

  it('billing units: HasData costs 15 credits per request', async () => {
    const b = budget('2026-11-30T08:00:00Z', { hasdata: 1000 });
    await b.reserve('hasdata');
    expect((await b.status(['hasdata']))[0]).toMatchObject({ usedMonth: 15, usedToday: 15, limit: 1000 });
  });

  it('unlimited providers are never counted or refused', async () => {
    const b = budget('2026-11-01T08:00:00Z', {});
    await b.reserve('travelpayouts');
    expect(await b.todayLeft('travelpayouts')).toBe(Infinity);
  });

  it('"quota exceeded" from the provider pauses it until the reset it reports', async () => {
    const b = budget('2026-11-12T08:00:00Z', { kiwi: 300 });
    await b.block('kiwi', 'You have exceeded the MONTHLY quota for Requests on your current plan, BASIC', 3600);
    await expect(b.reserve('kiwi')).rejects.toThrow(/paused until 2026-11-12T09:00/);
    expect(await b.todayLeft('kiwi')).toBe(0);
  });

  it("the provider's own counter (RapidAPI headers) overrides ours and teaches an unknown limit", async () => {
    const b = budget('2026-11-30T08:00:00Z', {});
    await b.sync('skyx', 100, 40);
    expect((await b.status(['skyx']))[0]).toMatchObject({ limit: 100, usedMonth: 60 });
  });

  it('recognises quota messages, not ordinary rate limits', () => {
    expect(isQuotaMessage('Your account has run out of searches.')).toBe(true);
    expect(isQuotaMessage('You have exceeded the MONTHLY quota for Requests on your current plan')).toBe(true);
    expect(isQuotaMessage('Too many requests')).toBe(false);
  });
});

describe('base currency (USD)', () => {
  it('parses Frankfurter v2 arrays and {base, rates} objects', () => {
    expect(parseRates([{ base: 'USD', quote: 'ILS', rate: 3.18 }, { base: 'USD', quote: 'EUR', rate: 0.9 }]))
      .toEqual({ base: 'USD', rates: { USD: 1, ILS: 3.18, EUR: 0.9 } });
    expect(parseRates({ result: 'success', base_code: 'USD', rates: { ILS: 3.2 } })).toEqual({ base: 'USD', rates: { USD: 1, ILS: 3.2 } });
    expect(parseRates({ nope: true })).toBeNull();
  });

  it('converts other quotes, keeps the original price, leaves USD untouched; cross rates via USD', async () => {
    const rates = new FxRates(() => 'unused');
    rates.setRates('USD', { ILS: 4, EUR: 0.8 });
    const o = (price: number, currency: string): ProviderOffer => ({
      provider: 't', origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
      outboundStops: 0, inboundStops: 0, price, currency, priceStatus: 'LIVE', observedAt: '',
      priceInsight: { level: 'low', typicalLow: 800, typicalHigh: 1200, history: [[1, 1000]] },
    });
    const [a, b] = await toCurrency([o(1000, 'ILS'), o(300, 'USD')], 'USD', rates);
    expect(a).toMatchObject({ price: 250, currency: 'USD', originalPrice: 1000, originalCurrency: 'ILS',
      priceInsight: { level: 'low', typicalLow: 200, typicalHigh: 300, history: [[1, 250]] } });
    expect(b).toMatchObject({ price: 300, currency: 'USD' });
    expect(b.originalCurrency).toBeUndefined();
    expect(await rates.rate('EUR', 'ILS')).toBe(5);
  });

  it('a currency without a rate fails loudly (the chain moves to the next provider)', async () => {
    const rates = new FxRates(() => 'unused');
    rates.setRates('USD', { ILS: 4 });
    await expect(rates.rate('XYZ', 'USD')).rejects.toThrow(/no exchange rate/);
  });
});

describe('Google price insights', () => {
  it('SerpApi price_insights: level, usual range, history in ms', () => {
    expect(priceInsight({ price_insights: { lowest_price: 420, price_level: 'low', typical_price_range: [480, 700], price_history: [[1691013600, 575]] } }))
      .toEqual({ level: 'low', typicalLow: 480, typicalHigh: 700, history: [[1691013600000, 575]] });
  });
  it('HasData priceInsights (camelCase)', () => {
    expect(priceInsight({ priceInsights: { priceLevel: 'typical', typicalPriceRange: [920, 1350] } }))
      .toEqual({ level: 'typical', typicalLow: 920, typicalHigh: 1350, history: undefined });
  });
  it('absent or empty → undefined', () => {
    expect(priceInsight({})).toBeUndefined();
    expect(priceInsight({ price_insights: {} })).toBeUndefined();
  });
});

describe('FlightPowers (Google Flights Live API via RapidAPI)', () => {
  const criteria: SearchCriteria = {
    origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
    adults: 2, cabinClass: 'BUSINESS', currency: 'USD', maxStops: 1,
  };
  // shape of the documented round-trip sample (flightpowers.com/flights-api/round-trip)
  const row = (price: number, stopsOut: any, extra: any = {}) => ({
    price_range_in_relation_to_other_periods: 'low', price_insights_low: 520, price_insights_high: 780,
    from_airport: 'Tel Aviv (TLV)', to_airport: 'Rome (FCO)', departure_date: '2027-05-10', return_date: '2027-05-20',
    total_price: `$${price}`, total_price_as_number: price, total_duration_seconds: 30000, total_stops: 1,
    buy_link: 'https://www.google.com/travel/flights?tfs=abc&curr=usd',
    departure_flight_airline: 'ITA', departure_flight_stops: stopsOut, departure_flight_duration: '3 hr 50 min',
    return_flight_airline: 'El Al', return_flight_stops: 1, return_flight_duration: '6 hr',
    ...extra,
  });
  let calls: { url: string; init?: any }[] = [];
  beforeEach(() => {
    config.providers.rapidapiKey = 'rk';
    calls = [];
    global.fetch = jest.fn(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify([row(612, 0), row(400, null)]), { status: 200 });
    }) as any;
  });

  it('one POST with IATA codes, one entry per passenger, stop limits per leg, strict mode', async () => {
    const { FlightPowersProvider } = await import('../src/providers/flightpowers.provider');
    await new FlightPowersProvider().searchFlights(criteria);
    expect(calls[0].url).toBe('https://google-flights-live-api.p.rapidapi.com/api/google_flights/roundtrip/v1');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({ 'x-rapidapi-key': 'rk', 'x-rapidapi-host': 'google-flights-live-api.p.rapidapi.com' });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      from_airport: 'TLV', to_airport: 'FCO', departure_date: '2027-05-10', return_date: '2027-05-20',
      passengers: [1, 1], seat_type: 3, currency: 'USD', max_departure_stops: 1, max_return_stops: 1,
      sort_type: 'Price', limit: 10, strict: true,
    });
  });

  it('maps stops, airlines, durations, link and Google price band; skips rows with unknown stops', async () => {
    const { FlightPowersProvider, parseDurationText } = await import('../src/providers/flightpowers.provider');
    const offers = await new FlightPowersProvider().searchFlights(criteria);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      provider: 'flightpowers', origin: 'TLV', destination: 'FCO', price: 612, currency: 'USD',
      outboundStops: 0, inboundStops: 1, airline: 'ITA, El Al', outboundDurationMin: 230, inboundDurationMin: 360,
      bookingUrl: 'https://www.google.com/travel/flights?tfs=abc&curr=usd', priceStatus: 'LIVE',
      priceInsight: { level: 'low', typicalLow: 520, typicalHigh: 780 },
    });
    expect(offers[0].segments).toBeUndefined();
    expect(parseDurationText('45 min')).toBe(45);
    expect(parseDurationText('n/a')).toBeUndefined();
  });
});

describe('flight numbers with IATA designators', () => {
  it("maps Skyscanner's own carrier codes seen in the TLV→FCO probe (12.11.2026) to IATA, like Kiwi reports them", async () => {
    const { iataFlightNumber } = await import('../src/providers/airlines');
    expect(iataFlightNumber('I*6044', 'Wizz Air Malta')).toBe('W46044');
    expect(iataFlightNumber('9_132', 'Blue Bird Airways')).toBe('BZ132');
    expect(iataFlightNumber('@6132', 'Tus Airways')).toBe('U8132');
    expect(iataFlightNumber('LY385', 'EL AL Israel Airlines')).toBe('LY385');
    expect(iataFlightNumber('6H341', 'Israir')).toBe('6H341');
    expect(iataFlightNumber('A3 925', 'Aegean Airlines')).toBe('A3925');
    expect(iataFlightNumber('Q*123', 'Unknown Air')).toBe('Q*123'); // unknown carrier – left as is
  });
});

describe('Skyscanner Scraper (OmkarCloud via RapidAPI)', () => {
  const criteria: SearchCriteria = {
    origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
    adults: 2, cabinClass: 'ECONOMY', currency: 'USD', maxStops: 1,
  };
  const place = (code: string) => ({ entity_id: '1', code, name: code, city: code, country: 'X' });
  const segment = (from: string, to: string, fn: string, dep: string, arr: string) => ({
    flight_number: fn, origin: place(from), destination: place(to), departure_at: dep, arrival_at: arr, duration_minutes: 200,
    marketing_carrier: { code: fn.slice(0, 2), name: fn.startsWith('LY') ? 'El Al' : 'ITA Airways' }, operating_carrier: { code: fn.slice(0, 2) },
  });
  // shape of the documented example (listing's OpenAPI spec)
  const result = (id: string, amount: number, extra: any = {}) => ({
    id, price: { amount, currency: 'USD', formatted: `$${amount}` }, duration_minutes: 900, stop_count: 1,
    legs: [
      { origin: place('TLV'), destination: place('FCO'), departure_at: '2027-05-10T06:00:00', arrival_at: '2027-05-10T09:20:00', duration_minutes: 260, stop_count: 0,
        segments: [segment('TLV', 'FCO', 'LY381', '2027-05-10T06:00:00', '2027-05-10T09:20:00')] },
      { origin: place('FCO'), destination: place('TLV'), departure_at: '2027-05-20T07:00:00', arrival_at: '2027-05-20T15:30:00', duration_minutes: 450, stop_count: 1,
        segments: [segment('FCO', 'MXP', 'AZ2010', '2027-05-20T07:00:00', '2027-05-20T08:10:00'), segment('MXP', 'TLV', 'AZ808', '2027-05-20T10:30:00', '2027-05-20T15:30:00')] },
    ],
    booking_options: [{ price: { amount, currency: 'USD' }, agents: [
      { name: 'Expensive OTA', price: { amount: amount + 40, currency: 'USD' }, link: 'https://www.skyscanner.net/transport_deeplink/b' },
      { name: 'El Al', price: { amount, currency: 'USD' }, link: 'https://www.skyscanner.net/transport_deeplink/a' },
    ] }],
    is_self_transfer: false, is_protected_self_transfer: false,
    ...extra,
  });
  let calls: string[] = [];
  beforeEach(() => {
    config.providers.rapidapiKey = 'rk';
    calls = [];
    global.fetch = jest.fn(async (url: any) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ status: 'complete', count: 3, total_results: 120, results: [
        result('a', 640),
        result('b', 410, { is_protected_self_transfer: true }),
        { id: 'c', price: { amount: 99, currency: 'USD' }, legs: [] },
      ] }), { status: 200 });
    }) as any;
  });

  it('one GET: IATA codes, stops per leg, USD, Israeli point of sale, cheapest first', async () => {
    const { SkyscannerScraperProvider } = await import('../src/providers/skyscanner-scraper.provider');
    await new SkyscannerScraperProvider().searchFlights(criteria);
    const u = new URL(calls[0]);
    expect(u.host).toBe('skyscanner-scraper-1000-free-calls.p.rapidapi.com');
    expect(u.pathname).toBe('/flights/search-roundtrip');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      origin: 'TLV', destination: 'FCO', depart_date: '2027-05-10', return_date: '2027-05-20',
      adults: '2', cabin_class: 'economy', stops: '1', currency: 'USD', market: 'IL', sort: 'cheapest',
    });
  });

  it('maps both legs with segments, cheapest agent link; protected self-transfer counts as self-transfer', async () => {
    const { SkyscannerScraperProvider } = await import('../src/providers/skyscanner-scraper.provider');
    const offers = await new SkyscannerScraperProvider().searchFlights(criteria);
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      provider: 'skyscanner_scraper', providerOfferId: 'a', price: 640, currency: 'USD',
      outboundStops: 0, inboundStops: 1, outboundDurationMin: 260, inboundDurationMin: 450,
      airline: 'El Al, ITA Airways', selfTransfer: false, priceStatus: 'LIVE',
      bookingUrl: 'https://www.skyscanner.net/transport_deeplink/a',
    });
    expect(offers[0].segments!.inbound.map((s) => s.flightNumber)).toEqual(['AZ2010', 'AZ808']);
    expect(offers[1].selfTransfer).toBe(true);
    expect(filterOffers(offers, 1, 'USD').map((o) => o.providerOfferId)).toEqual(['a']);
  });
});

describe('Kiwi.com via RapidAPI', () => {
  const criteria: SearchCriteria = {
    origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
    adults: 2, cabinClass: 'ECONOMY', currency: 'USD', maxStops: 1,
  };
  const seg = (from: string, to: string, code: string, n: string, dep: string, arr: string) => ({
    flight_number: n, carrier: { code, name: code === 'W4' ? 'Wizz Air Malta' : 'ITA Airways' },
    source: { station: { code: from }, local_time: dep }, destination: { station: { code: to }, local_time: arr },
  });
  const itinerary = (id: string, amount: number, inbound: any[], layovers: any[] = []) => ({
    id, type: 'RETURN', price: { amount, currency: 'USD' },
    outbound: { duration_seconds: 14400, segments: [seg('TLV', 'FCO', 'AZ', '811', '2027-05-10T08:00:00', '2027-05-10T11:00:00')], layovers: [] },
    inbound: { duration_seconds: 21600, segments: inbound, layovers },
    booking_options: [{ booking_url: `https://www.kiwi.com/en/booking?token=${id}`, price: { amount, currency: 'USD' } }],
  });
  let calls: { url: string; init?: any }[] = [];
  beforeEach(() => {
    config.providers.rapidapiKey = 'rk';
    calls = [];
    global.fetch = jest.fn(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        count: 3, currency: 'USD', itineraries: [
          itinerary('a', 412, [seg('FCO', 'MXP', 'AZ', '1', '2027-05-20T07:00:00', '2027-05-20T08:10:00'), seg('MXP', 'TLV', 'AZ', '2', '2027-05-20T10:00:00', '2027-05-20T14:30:00')]),
          itinerary('b', 300, [seg('FCO', 'BUD', 'W4', '6', '2027-05-20T06:00:00', '2027-05-20T08:00:00'), seg('BUD', 'TLV', 'W4', '7', '2027-05-20T12:00:00', '2027-05-20T15:30:00')],
            [{ is_baggage_recheck: true, transfer_type: 'SELF_TRANSFER' }]),
          { id: 'c', price: { amount: 100, currency: 'USD' }, outbound: { segments: [] }, inbound: null },
        ],
      }), { status: 200, headers: { 'x-ratelimit-requests-limit': '300', 'x-ratelimit-requests-remaining': '299' } });
    }) as any;
  });

  it('one request: IATA codes, RapidAPI headers, sorted by price', async () => {
    await new KiwiProvider().searchFlights(criteria);
    const u = new URL(calls[0].url);
    expect(u.host).toBe('kiwi-com-flights-api.p.rapidapi.com');
    expect(u.pathname).toBe('/api/v1/flights/search-roundtrip');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      source: 'TLV', destination: 'FCO', departure_date: '2027-05-10', return_date: '2027-05-20',
      adults: '2', cabin_class: 'ECONOMY', currency: 'USD', sort_by: 'PRICE',
    });
    expect(calls[0].init.headers).toMatchObject({ 'x-rapidapi-key': 'rk', 'x-rapidapi-host': 'kiwi-com-flights-api.p.rapidapi.com' });
  });

  it('maps both legs with real segments; drops itineraries without both legs; flags self-transfer', async () => {
    const offers = await new KiwiProvider().searchFlights(criteria);
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      provider: 'kiwi', providerOfferId: 'a', price: 412, currency: 'USD', outboundStops: 0, inboundStops: 1,
      outboundDurationMin: 240, inboundDurationMin: 360, priceStatus: 'LIVE', selfTransfer: false,
      bookingUrl: 'https://www.kiwi.com/en/booking?token=a',
    });
    expect(offers[0].segments!.inbound[1]).toEqual({ from: 'MXP', to: 'TLV', departAt: '2027-05-20T10:00:00', arriveAt: '2027-05-20T14:30:00', carrier: 'ITA Airways', flightNumber: 'AZ2' });
    expect(offers[1].selfTransfer).toBe(true);
    // the cheaper self-transfer one is excluded by the user criteria filter (MVP)
    expect(filterOffers(offers, 1, 'USD').map((o) => o.providerOfferId)).toEqual(['a']);
  });
});
