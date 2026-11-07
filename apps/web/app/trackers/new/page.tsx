'use client';
import AppShell from '@/components/AppShell';
import TrackerForm, { defaults } from '@/components/TrackerForm';
import { useI18n } from '@/lib/i18n';

export default function NewTracker() {
  const { t } = useI18n();
  return (
    <AppShell>
      <h1>{t.newTracker}</h1>
      <TrackerForm initial={defaults()} />
    </AppShell>
  );
}
