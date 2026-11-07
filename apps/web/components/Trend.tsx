'use client';
import { useI18n } from '@/lib/i18n';

const fmtPct = (n: number, locale: string) =>
  new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(n));

export function Trend({ pct, status }: { pct: number | null; status: string | null }) {
  const { t, locale } = useI18n();
  if (pct == null || !status || status === 'FIRST_CHECK' || status === 'NOT_COMPARABLE') return <span className="muted">—</span>;
  if (status === 'NO_SIGNIFICANT_CHANGE') return <span className="muted" title={t.NO_SIGNIFICANT_CHANGE}>{pct > 0 ? '+' : pct < 0 ? '−' : ''}{fmtPct(pct, locale)}%</span>;
  return pct < 0
    ? <span className="down" title={t.PRICE_DROPPED}>↓ {fmtPct(pct, locale)}%</span>
    : <span className="up" title={t.PRICE_INCREASED}>↑ {fmtPct(pct, locale)}%</span>;
}

/** Trend as a pill (dashboard table). No comparison yet → "Not enough data". */
export function TrendPill({ pct, status }: { pct: number | null; status: string | null }) {
  const { t, locale } = useI18n();
  if (pct == null || !status || status === 'FIRST_CHECK' || status === 'NOT_COMPARABLE') {
    return <span className="pill neutral" title={status ? (t as any)[status] : undefined}>{t.notEnoughData}</span>;
  }
  if (status === 'PRICE_DROPPED') return <span className="pill ok" title={t.PRICE_DROPPED}>↓ {fmtPct(pct, locale)}%</span>;
  if (status === 'PRICE_INCREASED') return <span className="pill bad" title={t.PRICE_INCREASED}>↑ {fmtPct(pct, locale)}%</span>;
  return <span className="pill neutral" title={t.NO_SIGNIFICANT_CHANGE}>{pct > 0 ? '+' : pct < 0 ? '−' : '— '}{fmtPct(pct, locale)}%</span>;
}

export function RunChip({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = status === 'SUCCESS' ? 'ok' : status === 'FAILED' ? 'bad' : status === 'PARTIAL' || status === 'NO_RESULTS' ? 'warn' : '';
  return <span className={`chip ${cls}`}>{(t as any)[status] ?? status}</span>;
}
