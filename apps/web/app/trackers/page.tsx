'use client';
import AppShell, { PageHeader } from '@/components/AppShell';
import TrackerTable from '@/components/TrackerTable';
import { NewTrackerButton, useTrackers } from '@/components/useTrackers';
import { useI18n } from '@/lib/i18n';

export default function Trackers() {
  const { t } = useI18n();
  const { items, error, load } = useTrackers();
  return (
    <AppShell crumb={t.dashboard}>
      <PageHeader title={t.dashboard} count={items?.length} sub={t.pageSub} action={<NewTrackerButton />} />
      {error && <div className="error">{error}</div>}
      {items ? <TrackerTable items={items} reload={load} /> : !error && <div className="card skeleton" />}
    </AppShell>
  );
}
