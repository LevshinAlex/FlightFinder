'use client';
import AppShell, { PageHeader } from '@/components/AppShell';
import TrackerForm, { defaults } from '@/components/TrackerForm';
import { useI18n } from '@/lib/i18n';

export default function NewTracker() {
  const { t } = useI18n();
  return (
    <AppShell crumb={t.newTracker}>
      <PageHeader title={t.newTracker} />
      <TrackerForm initial={defaults()} />
    </AppShell>
  );
}
