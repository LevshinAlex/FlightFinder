'use client';
import { useEffect, useMemo, useState } from 'react';
import AppShell, { PageHeader } from '@/components/AppShell';
import { IconCheck, IconClock, IconPlane, IconWallet } from '@/components/icons';
import TrackerTable from '@/components/TrackerTable';
import { NewTrackerButton, useTrackers } from '@/components/useTrackers';
import { api, money } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function Stat({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="card stat-card">
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-sub">{sub}</div>
      </div>
      <span className={`stat-icon ${tone}`}>{icon}</span>
    </div>
  );
}

export default function Dashboard() {
  const { t, locale } = useI18n();
  const { items, error, load } = useTrackers();
  const [reportTime, setReportTime] = useState<string | null>(null);
  useEffect(() => { api('/notifications/settings').then((p) => setReportTime(p?.preferredTime ?? null)).catch(() => {}); }, []);

  // Lowest price: compare only within one currency (₪ vs € numbers are not comparable)
  const lowest = useMemo(() => {
    const priced = (items ?? []).filter((i) => i.minPrice != null);
    if (!priced.length) return null;
    const byCur = new Map<string, number>();
    for (const i of priced) byCur.set(i.currency, (byCur.get(i.currency) ?? 0) + 1);
    const cur = [...byCur.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const min = Math.min(...priced.filter((i) => i.currency === cur).map((i) => i.minPrice));
    return { text: money(min, cur, locale), mixed: byCur.size > 1, cur };
  }, [items, locale]);

  const active = items?.filter((i) => i.status === 'ACTIVE').length ?? 0;

  return (
    <AppShell crumb={t.dashboard}>
      <PageHeader title={t.dashboard} count={items?.length} sub={t.pageSub} action={<NewTrackerButton />} />

      <section className="hero">
        <div className="hero-text">
          <div className="hero-kicker">✦ {t.heroKicker}</div>
          <h2>{t.heroTitle1}<br />{t.heroTitle2}</h2>
          <p>{t.heroText}</p>
        </div>
        <svg className="hero-art" viewBox="0 0 420 180" aria-hidden="true">
          <circle cx="330" cy="110" r="250" className="ring" />
          <path d="M60 175 C 90 40, 300 -10, 360 120 S 300 200, 250 175" className="route" />
          <g transform="translate(300 70) rotate(-35)" className="plane">
            <path d="M0 -42 L8 -10 L44 6 L44 14 L8 6 L4 34 L16 44 L16 50 L0 45 L-16 50 L-16 44 L-4 34 L-8 6 L-44 14 L-44 6 L-8 -10 Z" />
          </g>
        </svg>
      </section>

      <div className="stat-grid">
        <Stat label={t.statTotal} value={String(items?.length ?? '—')} sub={t.statTotalSub} icon={<IconPlane />} tone="blue" />
        <Stat label={t.statActive} value={String(items ? active : '—')} sub={t.statActiveSub} icon={<IconCheck />} tone="green" />
        <Stat label={t.statLowest} value={lowest?.text ?? '—'} sub={lowest?.mixed ? t.statLowestSubCur(lowest.cur) : t.statLowestSub} icon={<IconWallet />} tone="violet" />
        <Stat label={t.statUpdate} value={t.daily} sub={reportTime ? t.statUpdateSubAt(reportTime) : t.statUpdateSub} icon={<IconClock />} tone="amber" />
      </div>

      {error && <div className="error">{error}</div>}
      {items && <TrackerTable items={items} reload={load} />}
      {!items && !error && <div className="card skeleton" />}
    </AppShell>
  );
}
