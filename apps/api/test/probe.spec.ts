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
