'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Brand, LangSwitch, resetSessionCache } from './AppShell';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => { api('/auth/providers').then((p) => setGoogle(p.google)).catch(() => {}); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/auth/${mode}`, { method: 'POST', json: mode === 'login' ? { email, password } : { email, password, name: name || undefined, locale } });
      resetSessionCache();
      router.push('/dashboard'); // stays busy while navigating – no second submit
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="auth">
        <div className="row"><Brand /><span className="spacer" /><LangSwitch /></div>
        <p className="muted">{t.tagline}</p>
        <div className="card">
          <form onSubmit={submit}>
            <label className="field">{t.email}<input type="email" name="email" required autoComplete="email" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field">{t.password}
              <input type="password" name="password" required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'register' && <span className="small">{t.passwordHint}</span>}
            </label>
            {mode === 'register' && <label className="field">{t.name}<input name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>}
            {error && <div className="error" role="alert">{error}</div>}
            <button className="btn primary" disabled={busy}>
              {busy ? (mode === 'login' ? t.signingIn : t.creatingAccount) : mode === 'login' ? t.login : t.register}
            </button>
            {google && <a className="btn" href="/api/auth/google">{t.google}</a>}
          </form>
        </div>
        <p className="small" style={{ textAlign: 'center' }}>
          {mode === 'login' ? <>{t.noAccount} <Link href="/register">{t.register}</Link></> : <>{t.haveAccount} <Link href="/login">{t.login}</Link></>}
        </p>
      </div>
    </div>
  );
}
