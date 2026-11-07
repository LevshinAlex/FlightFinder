'use client';
import { useEffect, useState } from 'react';
import AppShell, { PageHeader } from '@/components/AppShell';
import TrackerForm, { TrackerValues } from '@/components/TrackerForm';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function EditTracker({ params }: { params: { id: string } }) {
  const { t } = useI18n();
  const [v, setV] = useState<TrackerValues | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/trackers/${params.id}`).then((d) => setV({
      name: d.name ?? '', originCountry: d.originCountry, originAirport: d.originAirport, destinationCountry: d.destinationCountry,
      destinationAirports: d.destinationAirports, departureDate: d.departureDate, returnDate: d.returnDate,
      departureFlexDays: d.departureFlexDays, departureFlexMode: d.departureFlexMode, returnFlexDays: d.returnFlexDays, returnFlexMode: d.returnFlexMode,
      maxStops: d.maxStops, adults: d.adults, cabinClass: d.cabinClass, currency: d.currency,
      targetPrice: d.targetPrice != null ? String(d.targetPrice) : '', significantChangePct: d.significantChangePct,
    })).catch((e) => setError(e.message));
  }, [params.id]);
  return (
    <AppShell crumb={t.editTracker}>
      <PageHeader title={t.editTracker} />
      {error && <div className="error">{error}</div>}
      {v && <TrackerForm initial={v} trackerId={params.id} />}
    </AppShell>
  );
}
