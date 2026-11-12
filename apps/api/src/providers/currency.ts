import { fx, FxRates, round2 } from '../common/fx';
import { FlightProvider, IndicativeCriteria, ProviderOffer, ProviderRequestError, SearchCriteria } from './flight-provider.interface';

/**
 * Normalizer: every offer leaves the provider layer in the currency that was asked for
 * (the base currency, USD). Quotes in another currency are converted with the daily reference
 * rate; the provider's own price is kept in originalPrice / originalCurrency.
 */
export async function toCurrency(offers: ProviderOffer[], currency: string, rates: FxRates = fx): Promise<ProviderOffer[]> {
  const target = currency.toUpperCase();
  const out: ProviderOffer[] = [];
  for (const o of offers) {
    const from = o.currency.toUpperCase();
    if (from === target) { out.push(o); continue; }
    const r = await rates.rate(from, target);
    const conv = (v?: number) => (v == null ? v : round2(v * r));
    out.push({
      ...o,
      price: round2(o.price * r), currency: target,
      originalPrice: o.originalPrice ?? o.price, originalCurrency: o.originalCurrency ?? from,
      baggagePrice: conv(o.baggagePrice),
      priceInsight: o.priceInsight && {
        ...o.priceInsight,
        typicalLow: conv(o.priceInsight.typicalLow), typicalHigh: conv(o.priceInsight.typicalHigh),
        history: o.priceInsight.history?.map(([t, p]) => [t, round2(p * r)] as [number, number]),
      },
    });
  }
  return out;
}

type WithOutboundOnly = { searchOutboundOnly?: (c: SearchCriteria) => Promise<ProviderOffer[]> };

/** Wraps one provider so its offers come back in the requested currency. */
export function withCurrencyNormalization<P extends FlightProvider & WithOutboundOnly>(p: P, rates: FxRates = fx): FlightProvider & WithOutboundOnly {
  const convert = async (offers: ProviderOffer[], currency: string) => {
    try {
      return await toCurrency(offers, currency, rates);
    } catch (e: any) {
      // not retryable here – the next provider in the chain takes over
      throw new ProviderRequestError(p.name, e.message);
    }
  };
  const outboundOnly = p.searchOutboundOnly?.bind(p);
  return {
    ...(outboundOnly ? { searchOutboundOnly: async (c: SearchCriteria) => convert(await outboundOnly(c), c.currency) } : {}),
    name: p.name,
    capabilities: p.capabilities,
    requestsPerLiveCheck: p.requestsPerLiveCheck,
    searchFlights: async (c: SearchCriteria) => convert(await p.searchFlights(c), c.currency),
    getIndicativePrices: async (c: IndicativeCriteria) => convert(await p.getIndicativePrices(c), c.currency),
    getFlightDetails: (id: string) => p.getFlightDetails(id),
    getBookingLink: (id: string) => p.getBookingLink(id),
    getProviderStatus: () => p.getProviderStatus(),
  };
}
