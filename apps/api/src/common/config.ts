import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the api folder or the monorepo root (does not override real env vars)
dotenv.config({ path: [path.resolve(process.cwd(), '.env'), path.resolve(__dirname, '../../../../.env')] });

const num = (v: string | undefined, d: number) => (v && !isNaN(Number(v)) ? Number(v) : d);

export const config = {
  // API_PORT locally; PORT is what PaaS hosts (Render, Railway, …) assign
  port: num(process.env.API_PORT ?? process.env.PORT, 4000),
  webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  manualSearchCooldownMin: num(process.env.MANUAL_SEARCH_COOLDOWN_MINUTES, 15),
  providers: {
    indicative: process.env.INDICATIVE_PROVIDER ?? 'mock',
    live: process.env.LIVE_PROVIDER ?? 'mock',
    /** Optional independent provider that re-checks the cheapest live result of each tracker. */
    control: process.env.CONTROL_PROVIDER ?? '',
    liveCheckTopN: num(process.env.LIVE_CHECK_TOP_N, 10),
    /** false → live-check only the top-N (no extra probe per destination airport) */
    liveAirportProbes: process.env.LIVE_AIRPORT_PROBES !== 'false',
    concurrency: num(process.env.PROVIDER_CONCURRENCY, 4),
    cacheTtlMin: num(process.env.SEARCH_CACHE_TTL_MINUTES, 180),
    travelpayoutsToken: process.env.TRAVELPAYOUTS_TOKEN ?? '',
    travelpayoutsMarker: process.env.TRAVELPAYOUTS_MARKER ?? '',
    duffelToken: process.env.DUFFEL_ACCESS_TOKEN ?? '',
    skyscannerKey: process.env.SKYSCANNER_API_KEY ?? '',
    serpapiKey: process.env.SERPAPI_KEY ?? '',
    ignavKey: process.env.IGNAV_API_KEY ?? '',
    hasdataKey: process.env.HASDATA_API_KEY ?? '',
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
