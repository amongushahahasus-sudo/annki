import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleHelp, KeyRound, LoaderCircle, LockKeyhole, LogOut, Mail, ShieldCheck, UserRound, X } from 'lucide-react';
import './auth.css';

type AuthConfig = { url: string; publishableKey: string };
type AuthMode = 'signin' | 'signup' | 'reset' | 'update' | 'account';
type ProviderSettings = { google: boolean; email: boolean };
type AuthState = { user: User | null; ready: boolean; configured: boolean; openAuth: () => void };
const AuthContext = createContext<AuthState | null>(null);

function validPublicKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(value)) return true;
  try {
    const parts = value.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'anon';
  } catch { return false; }
}

function parseConfig(value: unknown): AuthConfig | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== 'string' || !validPublicKey(candidate.publishableKey)) return null;
  try {
    const url = new URL(candidate.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
    return { url: url.origin, publishableKey: candidate.publishableKey };
  } catch { return null; }
}

function appUrl(): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.href);
  url.search = ''; url.hash = '';
  return url.href;
}

let clientPromise: Promise<{ client: SupabaseClient; config: AuthConfig } | null> | undefined;
function loadClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch(new URL('auth-config.json', appUrl()), { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const config = parseConfig(await response.json());
      if (!config) return null;
      const project = new URL(config.url).hostname.replace(/[^a-zA-Z0-9-]/g, '-');
      const client = createClient(config.url, config.publishableKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: `akasheet-auth-v1-${project}` },
      });
      return { client, config };
    })().catch(() => null);
  }
  return clientPromise;
}

function errorMessage(error: unknown, fallback = '処理できませんでした。しばらく待ってから、もう一度お試しください。'): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'invalid_credentials') return 'メールアドレスまたはパスワードが違います。';
  if (code === 'email_not_confirmed') return 'メールアドレスの確認が完了していません。登録時の確認メールを開いてください。';
  if (code === 'user_already_exists' || code === 'email_exists') return 'このメールアドレスでは登録済みです。ログインするか、パスワードを再設定してください。';
  if (code === 'weak_password' || code === 'same_password') return '別のパスワードを設定してください。8文字以上で、推測されにくいものを選んでください。';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || code === 'email_rate_limit_exceeded') return '短時間の操作が多いため、少し時間を置いてからお試しください。';
  if (code === 'email_address_not_authorized') return '現在、このメールアドレスへの認証メールを送信できません。メールでの新規登録・再設定は準備中です。';
  if (code === 'signup_disabled') return '現在、新規登録の受付を停止しています。';
  if (code === 'email_provider_disabled') return 'メールでのログインは現在準備中です。';
  if (code === 'provider_disabled' || code === 'oauth_provider_not_supported') return 'Googleログインは現在準備中です。';
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'flow_state_not_found' || code === 'bad_code_verifier' || code === 'bad_oauth_state') return '認証リンクの有効期限が切れたか、別のブラウザで開かれています。操作を始めたブラウザで、もう一度お試しください。';
  if (code === 'session_not_found' || code === 'refresh_token_not_found') return 'ログインの有効期限が切れました。もう一度ログインしてください。';
  if (error instanceof TypeError || (error && typeof error === 'object' && 'name' in error && /fetch|timeout|abort/i.test(String(error.name)))) return '通信できませんでした。インターネット接続を確認して、もう一度お試しください。';
  return fallback;
}

function callbackError(): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  const code = params.get('error_code') || params.get('error') || url.searchParams.get('error_code') || url.searchParams.get('error');
  if (!code) return '';
  if (code === 'access_denied') return 'ログインがキャンセルされたか、アクセスが許可されませんでした。もう一度お試しください。';
  return errorMessage({ code }, '認証を完了できませんでした。もう一度ログインしてください。');
}

function cleanAuthUrl() {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ['code', 'sb_flow_id', 'error', 'error_code', 'error_description']) {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  if (['access_token', 'refresh_token', 'error', 'error_description'].some(key => hash.has(key))) { url.hash = ''; changed = true; }
  if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [providers, setProviders] = useState<ProviderSettings | null>(null);
  const [dialog, setDialog] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [initialError, setInitialError] = useState('');
  const recoveryRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const controller = new AbortController();
    const authError = callbackError();
    void (async () => {
      const result = await loadClient();
      if (!alive) return;
      if (!result) { if (authError) { setInitialError(authError); setDialog(true); cleanAuthUrl(); } setReady(true); return; }
      const { client: instance, config } = result;
      setClient(instance);
      const { data: { subscription } } = instance.auth.onAuthStateChange((event, session) => {
        if (!alive) return;
        setUser(session?.user ?? null);
        if (event === 'PASSWORD_RECOVERY') { recoveryRef.current = true; setRecovery(true); setDialog(true); setInitialError(''); }
        if (event === 'SIGNED_IN' && !recoveryRef.current) setDialog(false);
        if (event === 'SIGNED_OUT') { recoveryRef.current = false; setRecovery(false); }
      });
      unsubscribe = () => subscription.unsubscribe();
      void fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.publishableKey }, signal: controller.signal, cache: 'no-store' }).then(async response => {
        if (!response.ok) return;
        const settings = await response.json();
        if (alive) setProviders({ google: settings.external?.google === true, email: settings.external?.email !== false });
      }).catch(() => {});
      try {
        const hadCode = new URL(window.location.href).searchParams.has('code');
        const { error: initializationError } = await instance.auth.initialize();
        const { data, error } = await instance.auth.getSession();
        if (!alive) return;
        setUser(data.session?.user ?? null);
        const unhandledCode = hadCode && new URL(window.location.href).searchParams.has('code');
        if (error || initializationError || authError || unhandledCode) {
          setInitialError(authError || errorMessage(initializationError || error, unhandledCode ? '認証リンクの有効期限が切れたか、別のブラウザで開かれています。操作を始めたブラウザで、もう一度お試しください。' : 'ログイン状況を確認できませんでした。もう一度ログインしてください。'));
          setDialog(true);
        }
      } catch (error) {
        if (alive) { setInitialError(errorMessage(error)); setDialog(true); }
      } finally {
        if (alive) { cleanAuthUrl(); setReady(true); }
      }
    })();
    return () => { alive = false; controller.abort(); unsubscribe?.(); };
  }, []);

  const openAuth = useCallback(() => { setInitialError(''); setDialog(true); }, []);
  const closeAuth = useCallback(() => { setDialog(false); setInitialError(''); }, []);
  const finishRecovery = useCallback(() => { recoveryRef.current = false; setRecovery(false); }, []);

  return <AuthContext.Provider value={{ user, ready, configured: !!client, openAuth }}>
    {children}
    {dialog && <AuthDialog client={client} user={user} providers={providers} recovery={recovery} initialError={initialError} close={closeAuth} finishRecovery={finishRecovery} />}
  </AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider is required');
  return auth;
}

export function AccountButton() {
  const { user, ready, openAuth } = useAuth();
  return <button className={`account-button ${user ? 'signed-in' : ''}`} onClick={openAuth} aria-label={user ? 'アカウントを開く' : 'ログイン'} disabled={!ready}>
    {user ? <span className="account-avatar">{(user.email?.slice(0, 1) || 'A').toUpperCase()}</span> : <UserRound size={16} />}
    <span>{user ? user.email || 'アカウント' : 'ログイン'}</span>
  </button>;
}

function GoogleMark() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.88-1.73 2.99-4.28 2.99-7.36Z" /><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.22-2.51c-.89.6-2.03.96-3.39.96-2.6 0-4.81-1.76-5.6-4.13H3.08v2.59A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.4 13.91A6 6 0 0 1 6.09 12c0-.66.11-1.3.31-1.91V7.5H3.08A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.5l3.32-2.59Z" /><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.49l2.86-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.92 5.5l3.32 2.59c.79-2.37 3-4.13 5.6-4.13Z" /></svg>;
}

function AuthDialog({ client, user, providers, recovery, initialError, close, finishRecovery }: {
  client: SupabaseClient | null; user: User | null; providers: ProviderSettings | null; recovery: boolean; initialError: string; close: () => void; finishRecovery: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(recovery ? 'update' : user ? 'account' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => { if (recovery) { setMode('update'); setError(''); setMessage(''); } }, [recovery]);
  useEffect(() => { if (!user && mode === 'account') { setMode('signin'); setPassword(''); setConfirmation(''); } }, [user, mode]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler, true);
    return () => { document.removeEventListener('keydown', handler, true); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);

  const changeMode = (next: AuthMode) => { setMode(next); setError(''); setMessage(''); setPassword(''); setConfirmation(''); };
  const title = mode === 'signup' ? 'アカウントを作成' : mode === 'reset' ? 'パスワードを再設定' : mode === 'update' ? '新しいパスワードを設定' : mode === 'account' ? 'アカウント' : '赤シートにログイン';

  async function googleLogin() {
    if (!client || !providers?.google || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { error: authError } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl(), queryParams: { prompt: 'select_account' } } });
      if (authError) throw authError;
    } catch (cause) { setError(errorMessage(cause, 'Googleログインを開始できませんでした。時間を置いてからお試しください。')); setBusy(false); }
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || busy) return;
    setError(''); setMessage('');
    if ((mode === 'signup' || mode === 'update') && password.length < 8) { setError('パスワードは8文字以上で入力してください。'); return; }
    if (mode === 'update' && password !== confirmation) { setError('確認用のパスワードが一致しません。'); return; }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        close();
      } else if (mode === 'signup') {
        const { data, error: authError } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: appUrl() } });
        if (authError) throw authError;
        setPassword('');
        if (data.session) close();
        else setMessage('確認メールを送信しました。メール内のリンクを、この操作を始めたブラウザで開くと登録が完了します。迷惑メールフォルダもご確認ください。');
      } else if (mode === 'reset') {
        const { error: authError } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
        if (authError) throw authError;
        setMessage('対象のアカウントがある場合、再設定メールが届きます。メール内のリンクを、この操作を始めたブラウザで開いてください。');
      } else if (mode === 'update') {
        const { error: authError } = await client.auth.updateUser({ password });
        if (authError) throw authError;
        setPassword(''); setConfirmation(''); finishRecovery(); setMode('account'); setMessage('パスワードを更新しました。');
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!client || busy) return;
    setBusy(true); setError('');
    try {
      const { error: authError } = await client.auth.signOut({ scope: 'local' });
      if (authError) throw authError;
      finishRecovery(); close();
    } catch (cause) { setError(errorMessage(cause, 'ログアウトできませんでした。接続を確認して、もう一度お試しください。')); }
    finally { setBusy(false); }
  }

  const loginMode = mode === 'signin' || mode === 'signup';
  const identityProviders = new Set((user?.identities || []).map(identity => identity.provider));
  const loginMethods = [identityProviders.has('google') ? 'Google' : '', identityProviders.has('email') ? 'メールアドレス' : ''].filter(Boolean).join('・') || 'メールアドレス';
  return <div className="auth-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title" tabIndex={-1} ref={dialogRef}>
      <div className="auth-heading"><span className="auth-heading-icon">{mode === 'account' ? <UserRound size={21} /> : mode === 'reset' || mode === 'update' ? <KeyRound size={21} /> : <LockKeyhole size={21} />}</span><button className="icon-button" aria-label="ログイン画面を閉じる" onClick={close}><X size={20} /></button></div>
      <h2 id="auth-dialog-title">{title}</h2>
      {error && <div className="auth-alert error" role="alert"><CircleHelp size={18} /><p>{error}</p></div>}
      {message && <div className="auth-alert success" role="status"><CheckCircle2 size={18} /><p>{message}</p></div>}
      {!client ? <><p className="auth-lead">ログイン機能は現在準備中です。</p><div className="auth-local-note"><ShieldCheck size={20} /><p>ログインせずに、PDFの取り込みと赤シートを利用できます。教材はこの端末のブラウザに保存されます。</p></div><button className="button secondary full" onClick={close}>ゲストで利用する <ArrowRight size={16} /></button></> : mode === 'account' && user ? <>
        <p className="auth-lead">ログインしています。</p>
        <div className="auth-account-details"><span className="auth-account-avatar">{(user.email?.slice(0, 1) || 'A').toUpperCase()}</span><div><strong>{user.email || 'メールアドレス未設定'}</strong><span>ログイン方法：{loginMethods}</span></div></div>
        <div className="auth-local-note"><ShieldCheck size={20} /><p>教材は、この端末のブラウザにアカウントごとに保存されます。別の端末との同期はありません。</p></div>
        <p className="auth-account-warning">ログアウト後も、このアカウントの教材は端末に残ります。共有端末では、教材を削除してからログアウトしてください。</p>
        <button className="button secondary full auth-signout" disabled={busy} onClick={() => void signOut()}>{busy ? <LoaderCircle className="spin" size={17} /> : <LogOut size={17} />} ログアウト</button>
      </> : <>
        <p className="auth-lead">{mode === 'signup' ? 'メールアドレスとパスワードで登録できます。' : mode === 'reset' ? '登録したメールアドレスに、再設定用のリンクを送ります。' : mode === 'update' ? '新しいパスワードを入力してください。' : 'Googleまたはメールアドレスでログインできます。'}</p>
        {loginMode && <><button className="auth-google" onClick={() => void googleLogin()} disabled={busy || !providers?.google}><GoogleMark /><span>Googleでログイン</span><ArrowRight size={16} /></button>{!providers?.google && <p className="auth-provider-note">Googleログインは現在準備中です。</p>}<div className="auth-divider"><span />またはメールアドレスで<span /></div></>}
        <form onSubmit={event => void submit(event)}>
          {mode !== 'update' && <label className="auth-field">メールアドレス<span className="auth-input-wrap"><Mail size={17} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" maxLength={254} required disabled={busy} /></span></label>}
          {mode !== 'reset' && <label className="auth-field">パスワード<span className="auth-input-wrap"><LockKeyhole size={17} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={mode === 'signin' ? 'パスワードを入力' : '8文字以上で入力'} minLength={mode === 'signin' ? undefined : 8} maxLength={128} required disabled={busy} /></span></label>}
          {mode === 'update' && <label className="auth-field">パスワード（確認）<span className="auth-input-wrap"><LockKeyhole size={17} /><input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" placeholder="もう一度入力" minLength={8} maxLength={128} required disabled={busy} /></span></label>}
          {mode === 'signin' && <button className="auth-forgot" type="button" disabled={busy} onClick={() => changeMode('reset')}>パスワードを忘れた方</button>}
          {providers?.email === false && <p className="auth-provider-note">メールでのログインは現在準備中です。</p>}
          <button className="button primary full auth-submit" type="submit" disabled={busy || providers?.email === false}>{busy ? <LoaderCircle className="spin" size={17} /> : mode === 'reset' ? <Mail size={17} /> : null}{mode === 'signup' ? 'アカウントを作成' : mode === 'reset' ? '再設定メールを送る' : mode === 'update' ? 'パスワードを更新' : 'メールでログイン'}{!busy && <ArrowRight size={16} />}</button>
        </form>
        {mode === 'signin' ? <p className="auth-switch">はじめての方は<button disabled={busy} onClick={() => changeMode('signup')}>新規登録する</button></p> : mode !== 'update' ? <button className="auth-back" disabled={busy} onClick={() => changeMode('signin')}><ArrowLeft size={14} /> ログインに戻る</button> : null}
        {loginMode && <div className="auth-local-note"><ShieldCheck size={19} /><p>教材は端末内に保存されます。ログインせずに利用することもできます。</p></div>}
        <button className="auth-guest" disabled={busy} onClick={close}>{mode === 'update' ? 'あとで設定する' : 'ログインせずに利用する'}</button>
      </>}
    </div>
  </div>;
}
