'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppShell, { PageHeader } from '@/components/AppShell';
import { api, fmtDateTime } from '@/lib/api';
import { Locale, useI18n } from '@/lib/i18n';

const TIMEZONES = ['Asia/Jerusalem', 'Europe/Moscow', 'Europe/Kyiv', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'UTC'];

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [prefs, setPrefs] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/notifications/settings').then(setPrefs).catch((e) => setError(e.message));
    api('/user/profile').then((p) => { setProfile(p); setConsent(!!p.whatsappConsentAt); }).catch(() => {});
    api('/notifications/logs').then(setLogs).catch(() => {});
  }, []);

  const flash = (m: string) => { setMsg(m); setError(''); setTimeout(() => setMsg(''), 2500); };
  const fail = (e: any) => { setError(e.message); setMsg(''); };

  const saveProfile = async () => {
    try {
      const p = await api('/user/profile', { method: 'PUT', json: { name: profile.name ?? '', phone: profile.phone ?? '', whatsappConsent: consent, locale } });
      setProfile(p); setConsent(!!p.whatsappConsentAt);
      setPrefs(await api('/notifications/settings'));
      flash(t.saved);
    } catch (e) { fail(e); }
  };

  const savePrefs = async () => {
    try {
      const { userId, ...body } = prefs;
      setPrefs(await api('/notifications/settings', { method: 'PUT', json: body }));
      flash(t.saved);
    } catch (e) { fail(e); }
  };

  const test = async () => {
    try { await api('/notifications/test', { method: 'POST', json: { channel: 'EMAIL' } }); flash(t.testSent); api('/notifications/logs').then(setLogs); }
    catch (e) { fail(e); }
  };

  const deleteAccount = async () => {
    if (!confirm(t.confirmDeleteAccount)) return;
    await api('/user/account', { method: 'DELETE' });
    router.push('/register');
  };

  const changeLocale = async (l: Locale) => {
    setLocale(l);
    try { await api('/user/profile', { method: 'PUT', json: { locale: l } }); } catch {}
  };

  const waReady = !!profile?.phone && !!profile?.whatsappConsentAt;

  return (
    <AppShell crumb={t.settings}>
      <PageHeader title={t.settings} />
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <h2>{t.notifications}</h2>
      {prefs && (
        <div className="card">
          <div className="form-grid">
            <label className="check"><input type="checkbox" checked={prefs.emailEnabled} onChange={(e) => setPrefs({ ...prefs, emailEnabled: e.target.checked })} /> {t.emailCh}</label>
            <label className="check" title={waReady ? '' : t.waNeedsConsent}>
              <input type="checkbox" disabled={!waReady} checked={prefs.whatsappEnabled} onChange={(e) => setPrefs({ ...prefs, whatsappEnabled: e.target.checked })} /> {t.whatsappCh}
              {!waReady && <span className="small muted">({t.waNeedsConsent})</span>}
            </label>
            <label className="check"><input type="checkbox" checked={prefs.dailySummaryEnabled} onChange={(e) => setPrefs({ ...prefs, dailySummaryEnabled: e.target.checked })} /> {t.dailySummary}</label>
            <label className="check"><input type="checkbox" checked={prefs.priceDropAlertEnabled} onChange={(e) => setPrefs({ ...prefs, priceDropAlertEnabled: e.target.checked })} /> {t.dropAlert}</label>
            <label className="field">{t.dropPct}<input type="number" min={1} max={90} value={prefs.priceDropAlertPct} onChange={(e) => setPrefs({ ...prefs, priceDropAlertPct: +e.target.value })} /></label>
            <label className="field">{t.reportTime}<input type="time" value={prefs.preferredTime} onChange={(e) => setPrefs({ ...prefs, preferredTime: e.target.value })} /></label>
            <label className="field">{t.timezone}
              <select value={prefs.timezone} onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}>
                {[...new Set([prefs.timezone, ...TIMEZONES])].map((z) => <option key={z}>{z}</option>)}
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={savePrefs}>{t.saveChanges}</button>
            <button className="btn" onClick={test}>{t.sendTest}</button>
          </div>
        </div>
      )}

      <h2>{t.profile}</h2>
      {profile && (
        <div className="card">
          <div className="form-grid">
            <label className="field">{t.email}<input value={profile.email} disabled /></label>
            <label className="field">{t.name}<input value={profile.name ?? ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
            <label className="field">{t.phone}<input type="tel" placeholder="+972501234567" value={profile.phone ?? ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value.trim() })} /></label>
            <label className="field">{t.language}
              <select value={locale} onChange={(e) => changeLocale(e.target.value as Locale)}>
                <option value="ru">Русский</option><option value="en">English</option>
              </select>
            </label>
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={consent} disabled={!profile.phone} onChange={(e) => setConsent(e.target.checked)} /> {t.waConsent}
          </label>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={saveProfile}>{t.saveChanges}</button>
            <span className="spacer" />
            <button className="btn danger" onClick={deleteAccount}>{t.deleteAccount}</button>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <>
          <h2>{t.recentNotifications}</h2>
          <div className="card table-wrap" style={{ padding: 8 }}>
            <table>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="small">{fmtDateTime(l.sentAt, locale)}</td><td className="small">{l.channel}</td>
                    <td className="small muted">{l.kind}</td>
                    <td><span className={`chip ${l.status === 'SENT' ? 'ok' : l.status === 'FAILED' ? 'bad' : ''}`}>{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
