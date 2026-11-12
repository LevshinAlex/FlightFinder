'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { setTrackerCount } from './AppShell';
import { IconPlus } from './icons';

/** Loads the tracker list and refreshes it while a search is running (the UI never blocks on search). */
export function useTrackers() {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<any[]>('/trackers').then((l) => { setItems(l); setTrackerCount(l.length); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!items?.some((i) => i.inProgress)) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [items, load]);
  return { items, error, load };
}

export function NewTrackerButton() {
  const { t } = useI18n();
  return <Link className="btn primary lg" href="/trackers/new"><IconPlus size={18} />{t.newTracker}</Link>;
}
