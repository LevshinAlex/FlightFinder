import { ProviderOffer, SearchCriteria } from '../src/providers/flight-provider.interface';
import { carrierCodes, chooseLiveTargets, compareByRoute, indicativeRequests, renderMarkdown, summarize } from '../scripts/probe-lib';

const offer = (p: Partial<ProviderOffer>): ProviderOffer => ({
  provider: 'x', origin: 'TLV', destination: 'FCO', departureDate: '2027-05-10', returnDate: '2027-05-20',
  outboundStops: 0, inboundStops: 0, price: 1000, currency: 'ILS', priceStatus: 'LIVE', observedAt: '2026-11-07T00:00:00Z', ...p,
});
const seg = (flightNumber: string) => ({ from: 'TLV', to: 'FCO', flightNumber });
const crit = (destination: string, departureDate = '2027-05-10', returnDate = '2027-05-20'): SearchCriteria => ({
  origin: 'TLV', destination, departureDate, returnDate, adults: 1, cabinClass: 'ECONOMY', currency: 'ILS', maxStops: 1,
});

describe('probe-lib', () => {
  it('extracts carrier codes incl. digit-led ones (6H Israir)', () => {
    const o = offer({ segments: { outbound: [seg('6H123'), seg('LY381')], inbound: [seg('W62327'), seg('LY382')] } });
    expect(carrierCodes(o).sort()).toEqual(['6H', 'LY', 'W6']);
    expect(carrierCodes(offer({}))).toEqual([]);
  });

  it('counts carriers only on usable offers; rankingOnly ignored', () => {
    const s = summarize('ignav', 'live', [
      offer({ segments: { outbound: [seg('LY381')], inbound: [seg('LY382')] } }),
      offer({ outboundStops: 3, segments: { outbound: [seg('IZ1')], inbound: [] } }),   // too many stops
      offer({ rankingOnly: true }),
    ], 1, 'ILS', 1, 0, [], 10);
    expect(s.usableOffers).toBe(1);
    expect(s.carriers).toEqual({ LY: 1 });
  });

  it('live targets: cheapest indicative routes, then one probe per fallback airport', () => {
    const all = [crit('FCO'), crit('FCO', '2027-05-11'), crit('MXP'), crit('VCE'), crit('NAP')];
    const ind = [offer({ destination: 'FCO', departureDate: '2027-05-11', price: 500 }), offer({ destination: 'MXP', price: 700 })];
    const t = chooseLiveTargets(all, ind, 1, 'ILS', ['FCO', 'VCE', 'NAP'], 4);
    expect(t.map((x) => `${x.destination}:${x.departureDate.slice(8)}`)).toEqual(['FCO:11', 'MXP:10', 'VCE:10', 'NAP:10']);
    expect(chooseLiveTargets(all, ind, 1, 'ILS', ['VCE'], 1)).toHaveLength(1);
  });

  it('request budget: ignav = one per trip length per airport', () => {
    const combos = [
      { departureDate: '2027-05-10', returnDate: '2027-05-20' },
      { departureDate: '2027-05-11', returnDate: '2027-05-21' },
      { departureDate: '2027-05-11', returnDate: '2027-05-20' },
    ];
    expect(indicativeRequests('ignav', 18, combos)).toBe(36);
    expect(indicativeRequests('travelpayouts', 18, combos)).toBe(54);
  });

  it('compares cheapest price per route across providers', () => {
    const rows = compareByRoute({
      ignav: [offer({ price: 1000 }), offer({ price: 900 })],
      serpapi: [offer({ price: 950 }), offer({ destination: 'MXP', price: 1200 })],
    }, 1, 'ILS');
    expect(rows[0]).toMatchObject({ route: 'TLV-FCO-20270510-20270520', prices: { ignav: 900, serpapi: 950 }, cheapestBy: ['ignav'], spreadPct: 5.6 });
    expect(rows[1].spreadPct).toBeNull();
    const md = renderMarkdown({
      generatedAt: 'now', plan: { origin: 'TLV', country: 'IT', airports: ['FCO'], combos: 1, maxStops: 1, currency: 'ILS', adults: 1 },
      stats: [summarize('ignav', 'live', [offer({ segments: { outbound: [seg('LY381')], inbound: [] } })], 1, 'ILS', 1, 0, [], 5)],
      targets: [crit('FCO')], comparison: rows, skipped: ['hasdata (no key)'],
    });
    expect(md).toContain('| 🇮🇱 El Al (LY) | 1 |');
    expect(md).toContain('**900**');
    expect(md).toContain('hasdata (no key)');
  });
});

import { installRequestGuard, planIndicativeCalls } from '../scripts/probe-lib';
import { config } from '../src/common/config';
import { SerpApiProvider } from '../src/providers/serpapi.provider';

describe('probe budget: 1 request per provider', () => {
  const combos = [
    { departureDate: '2027-05-10', returnDate: '2027-05-18' },
    { departureDate: '2027-05-10', returnDate: '2027-05-20' },
    { departureDate: '2027-05-11', returnDate: '2027-05-19' },
    { departureDate: '2027-05-12', returnDate: '2027-05-20' },
  ];

  it('travelpayouts: 1 request = first priority airport × middle date pair', () => {
    const calls = planIndicativeCalls('travelpayouts', ['FCO', 'MXP'], combos, 1);
    expect(calls).toEqual([{ destination: 'FCO', combinations: [combos[2]], requests: 1 }]);
    expect(planIndicativeCalls('travelpayouts', ['FCO', 'MXP'], combos, 6).map((c) => [c.destination, c.requests])).toEqual([['FCO', 4], ['MXP', 2]]);
    expect(planIndicativeCalls('travelpayouts', ['FCO'], combos, 0)).toEqual([]);
  });

  it('ignav: 1 request = one airport, every date pair of the middle trip length', () => {
    const [c] = planIndicativeCalls('ignav', ['FCO', 'MXP'], combos, 1);
    expect(c.destination).toBe('FCO');
    expect(c.requests).toBe(1);
    expect(c.combinations).toEqual([combos[0], combos[2], combos[3]]); // stay 8: 10→18, 11→19, 12→20
  });

  it('guard: second request to the same provider is refused without being sent', async () => {
    const sent: string[] = [];
    const fake = (async (u: any) => { sent.push(String(u)); return new Response('{}'); }) as any;
    const g = installRequestGuard(1, fake);
    try {
      await fetch('https://serpapi.com/search.json?a=1');
      await expect(fetch('https://serpapi.com/search.json?a=2')).rejects.toThrow(/already used 1/);
      await fetch('https://ignav.com/api/fares/round-trip');
    } finally { g.restore(); }
    expect(sent).toEqual(['https://serpapi.com/search.json?a=1', 'https://ignav.com/api/fares/round-trip']);
    expect(g.used).toEqual({ serpapi: 1, ignav: 1 });
    expect(g.blocked).toEqual({ serpapi: 1 });
  });

  it('serpapi outbound-only: exactly 1 request, real outbound carriers, counted in coverage', async () => {
    config.providers.serpapiKey = 'k';
    const sent: string[] = [];
    const page = { best_flights: [{ price: 1400, flights: [{ departure_airport: { id: 'TLV' }, arrival_airport: { id: 'FCO' }, airline: 'El Al', flight_number: 'LY 381' }], departure_token: 't' }] };
    const g = installRequestGuard(1, (async (u: any) => { sent.push(String(u)); return new Response(JSON.stringify(page)); }) as any);
    let offers: ProviderOffer[];
    try { offers = await new SerpApiProvider().searchOutboundOnly(crit('FCO')); } finally { g.restore(); }
    expect(sent).toHaveLength(1);
    expect(offers![0]).toMatchObject({ price: 1400, rankingOnly: true, outboundStops: 0 });
    expect(summarize('serpapi', 'live', offers!, 1, 'ILS', 1, 0, [], 1).carriers).toEqual({ LY: 1 });
  });
});
