import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the api folder or the monorepo root (does not override real env vars)
dotenv.config({ path: [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../../../../.env')] });

const num = (v: string | undefined, d: number) => (v && !isNaN(Number(v)) ? Number(v) : d);
/** Provider list from env; "none" / "off" switch a stage off explicitly (an empty value may not survive a host's env UI). */
export const providerList = (v: string | undefined, d: string) => {
  const s = (v ?? d).trim();
  return /^(none|off)$/i.test(s) ? '' : s;
};

export const config = {
  // API_PORT locally; PORT is what PaaS hosts (Render, Railway, …) assign
  port: num(process.env.API_PORT ?? process.env.PORT, 4000),
  webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  manualSearchCooldownMin: num(process.env.MANUAL_SEARCH_COOLDOWN_MINUTES, 15),
  /** Every price is stored, compared and shown in this currency; other quotes are converted (currency.ts). */
  baseCurrency: (process.env.BASE_CURRENCY ?? 'USD').toUpperCase(),
  /** Reference exchange rates: no key, no quota, no attribution (see fx.ts for accepted formats). */
  fxRatesUrl: process.env.FX_RATES_URL ?? 'https://api.frankfurter.dev/v2/rates?base=USD',
  providers: {
    indicative: providerList(process.env.INDICATIVE_PROVIDER, 'mock'),
    live: providerList(process.env.LIVE_PROVIDER, 'mock'),
    /** Optional independent provider that re-checks the cheapest live result of each tracker. */
    control: providerList(process.env.CONTROL_PROVIDER, ''),
    liveCheckTopN: num(process.env.LIVE_CHECK_TOP_N, 10),
    /** false → live-check only the top-N (no extra probe per destination airport) */
    liveAirportProbes: process.env.LIVE_AIRPORT_PROBES !== 'false',
    concurrency: num(process.env.PROVIDER_CONCURRENCY, 4),
    /** Hard limit for one provider request: a slower provider is skipped (the next one in the chain takes over), never awaited longer. */
    timeoutMs: Math.max(1, num(process.env.PROVIDER_TIMEOUT_SECONDS, 30)) * 1000,
    cacheTtlMin: num(process.env.SEARCH_CACHE_TTL_MINUTES, 180),
    /** Free-tier quotas: "serpapi:250,hasdata:1000" in each provider's billing units (overrides budget.ts defaults; 0 = unlimited). */
    monthlyLimits: process.env.PROVIDER_MONTHLY_LIMITS ?? '',
    /** Spread each monthly quota evenly over the days left, so it lasts the whole month. */
    dailyPacing: process.env.PROVIDER_DAILY_PACING !== 'false',
    budgetsEnabled: process.env.PROVIDER_BUDGETS !== 'false' && process.env.NODE_ENV !== 'test',
    /** Ignav prices in the currency of its point-of-sale market; we convert to the base currency. */
    ignavMarket: (process.env.IGNAV_MARKET ?? 'IL').toUpperCase(),
    /** Skyscanner point of sale (skyscanner_scraper): changes fares and partners, not only the language. */
    skyscannerMarket: (process.env.SKYSCANNER_MARKET ?? 'IL').toUpperCase(),
    travelpayoutsToken: process.env.TRAVELPAYOUTS_TOKEN ?? '',
    travelpayoutsMarker: process.env.TRAVELPAYOUTS_MARKER ?? '',
    duffelToken: process.env.DUFFEL_ACCESS_TOKEN ?? '',
    skyscannerKey: process.env.SKYSCANNER_API_KEY ?? '',
    serpapiKey: process.env.SERPAPI_KEY ?? '',
    ignavKey: process.env.IGNAV_API_KEY ?? '',
    hasdataKey: process.env.HASDATA_API_KEY ?? '',
    /** One RapidAPI key for every RapidAPI listing (each listing needs its own free BASIC subscription). */
    rapidapiKey: process.env.RAPIDAPI_KEY ?? '',
  },
  email: {
    transport: process.env.EMAIL_TRANSPORT ?? 'console',
    resendKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? 'Flight Tracker <reports@example.com>',
  },
  whatsapp: {
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? 'daily_flight_summary',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3000/api/auth/google/callback',
  },
};
