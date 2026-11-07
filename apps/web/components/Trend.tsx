'use client';
import { useI18n } from '@/lib/i18n';

export function Trend({ pct, status }: { pct: number | null; status: string | null }) {
  const { t } = useI18n();
  if (pct == null || !status || status === 'FIRST_CHECK' || status === 'NOT_COMPARABLE') return <span className="muted">—</span>;
  if (status === 'NO_SIGNIFICANT_CHANGE') return <span className="muted" title={t.NO_SIGNIFICANT_CHANGE}>⚪ {pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
  return pct < 0
    ? <span className="down" title={t.PRICE_DROPPED}>↓ {Math.abs(pct).toFixed(1)}%</span>
    : <span className="up" title={t.PRICE_INCREASED}>↑ {pct.toFixed(1)}%</span>;
}

export function RunChip({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = status === 'SUCCESS' ? 'ok' : status === 'FAILED' ? 'bad' : status === 'PARTIAL' || status === 'NO_RESULTS' ? 'warn' : '';
  return <span className={`chip ${cls}`}>{(t as any)[status] ?? status}</span>;
}
