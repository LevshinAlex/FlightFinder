/** Optional Sentry hookup: install `@sentry/node` and set SENTRY_DSN to enable. */
export function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
  } catch {
    console.warn('SENTRY_DSN is set but @sentry/node is not installed');
  }
}
