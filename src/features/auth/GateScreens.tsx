/* Before the app: sign in, activate an invitation (or a new-password link), an account without access, the splash. */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Eye, EyeOff, LogIn, KeyRound } from 'lucide-preact';
import { t, lang, setLang } from '../../lib/i18n';
import { EMAIL_RE } from '../../lib/text';
import { signIn, googleEnabled, signInGoogle, session, signOut, inviteToken, clearInvite, retryAccess, authState, callFn } from '../../data/auth';
import { errorMessage } from '../../data/api';
import { appBase } from '../../lib/config';
import { Button, Field, Input, InputWithButton, Form, Banner, Sheet, Seg } from '../../ui';

function Gate(p: { children: ComponentChildren; testid: string }) {
  return (
    <div class="gate" data-testid={p.testid}>
      <div class="gate-panel glass-strong">
        <img class="gate-logo" src="./logo-his.png" alt="Mécanique Mobile H.I.S" width="88" height="88" />
        {p.children}
        <div class="gate-foot">
          <Seg value={lang.value} onValue={(v) => setLang(v)} label={lang.value === 'en' ? 'Language' : 'Langue'} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
        </div>
      </div>
    </div>
  );
}

export function Splash() {
  return <div class="splash" aria-busy="true" aria-label={t('shell.splash')}><img src="./logo-his.png" alt="" width="96" height="96" /></div>;
}

function PasswordInput(p: { value: string; onValue: (v: string) => void; autoComplete: string; id?: string; invalid?: boolean; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <InputWithButton id={p.id} type={show ? 'text' : 'password'} value={p.value} onValue={p.onValue} autoComplete={p.autoComplete} invalid={p.invalid} autoFocus={p.autoFocus}
      button={<button type="button" class="iconbtn" aria-label={show ? t('auth.hide') : t('auth.show')} onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button>} />
  );
}

export function LoginScreen() {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('his.email') || ''; } catch { return ''; } });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const [forgot, setForgot] = useState(false);
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  useEffect(() => { void googleEnabled().then(setGoogle); }, []);
  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) { setError(t('auth.missing')); return; }
    const r = await signIn(email, password);
    if (r) setError(r.includes('.') && !r.includes(' ') ? t(r) : r);
  };
  return (
    <Gate testid="login">
      <div class="stack" style={{ gap: '6px' }}>
        <h1>{t('auth.title')}</h1>
        <p class="gate-lead">{t('auth.lead')}</p>
      </div>
      {offline && <Banner kind="warn">{t('auth.offlineNote')}</Banner>}
      <Form onSubmit={() => undefined} class="stack">
        <Field label={t('auth.email')}>
          <Input type="email" inputMode="email" autoComplete="username" value={email} onValue={setEmail} autoFocus={!email} data-testid="login-email" />
        </Field>
        <Field label={t('auth.password')} error={error}>
          <PasswordInput value={password} onValue={setPassword} autoComplete="current-password" autoFocus={!!email} invalid={!!error} />
        </Field>
        <Button type="submit" variant="primary" block icon={<LogIn size={20} />} onClick={submit} data-testid="login-submit">{t('auth.signIn')}</Button>
      </Form>
      {google && (
        <>
          <div class="or-line">{t('auth.or')}</div>
          <Button block onClick={() => signInGoogle()}>{t('auth.google')}</Button>
        </>
      )}
      <Button variant="ghost" icon={<KeyRound size={18} />} onClick={() => setForgot(true)}>{t('auth.forgot')}</Button>
      <ForgotSheet open={forgot} onClose={() => setForgot(false)} email={email} />
    </Gate>
  );
}

function ForgotSheet(p: { open: boolean; onClose: () => void; email: string }) {
  const [email, setEmail] = useState(p.email);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (p.open) { setEmail(p.email); setSent(false); setError(null); } }, [p.open]);
  const send = async () => {
    if (!EMAIL_RE.test(email.trim())) { setError(t('errors.email')); return; }
    const r = await callFn('team', { action: 'forgot', email: email.trim(), base: appBase(), lang: lang.value });
    if (!r.ok && r.code !== undefined && r.code !== 'not_found') { setError(errorMessage(r)); return; }
    setSent(true);
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('auth.forgotTitle')}
      footer={sent ? <Button variant="primary" onClick={p.onClose}>{t('common.ok')}</Button> : <Button variant="primary" onClick={send}>{t('auth.forgotSend')}</Button>}>
      {sent ? <Banner kind="ok">{t('auth.forgotSent')}</Banner> : (
        <div class="stack">
          <p class="muted" style={{ margin: 0 }}>{t('auth.forgotLead')}</p>
          <Field label={t('auth.email')} error={error}><Input type="email" inputMode="email" autoComplete="username" value={email} onValue={setEmail} onEnter={send} /></Field>
        </div>
      )}
    </Sheet>
  );
}

interface InviteInfo { name: string; email: string; roles: string[]; kind: 'invite' | 'reset'; lang: 'fr' | 'en'; garage: string }
export function InviteScreen() {
  const token = inviteToken.value || '';
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signedAs = session.value?.user?.email || null;
  useEffect(() => {
    void callFn<InviteInfo>('team', { action: 'invite-info', token }).then((r) => {
      if (r.ok) { setInfo(r); if (r.lang === 'en' || r.lang === 'fr') setLang(r.lang); }
      else setProblem(errorMessage(r));
    }, (e) => setProblem(errorMessage(e)));
  }, [token]);
  const leave = () => { clearInvite(); authState.value = session.value ? 'ready' : 'signed_out'; };
  if (problem) {
    return (
      <Gate testid="invite">
        <h1>{t('auth.linkProblem')}</h1>
        <Banner kind="warn">{problem}</Banner>
        <Button variant="primary" block onClick={leave}>{t('auth.toSignIn')}</Button>
      </Gate>
    );
  }
  if (!info) return <Gate testid="invite"><p class="gate-lead" aria-busy="true">{t('auth.inviteChecking')}</p></Gate>;
  if (signedAs && signedAs.toLowerCase() !== info.email.toLowerCase()) {
    return (
      <Gate testid="invite">
        <h1>{info.kind === 'reset' ? t('auth.forgotTitle') : t('auth.inviteTitle')}</h1>
        <Banner kind="warn">{t('auth.alreadyIn', { email: signedAs })}</Banner>
        <Button variant="primary" block onClick={async () => { await signOut(true); authState.value = 'invite'; }}>{t('auth.signOutFirst')}</Button>
      </Gate>
    );
  }
  const activate = async () => {
    setError(null);
    if (pw.length < 8) { setError(t('auth.tooShort')); return; }
    if (pw !== pw2) { setError(t('auth.mismatch')); return; }
    const r = await callFn<{ email: string }>('team', { action: 'invite-accept', token, password: pw });
    if (!r.ok) { setError(errorMessage(r)); return; }
    clearInvite();
    authState.value = 'loading';
    const err = await signIn(r.email || info.email, pw);
    if (err) { setError(err.includes(' ') ? err : t(err)); authState.value = 'signed_out'; }
  };
  const roles = info.roles.map((r) => t(`auth.roles.${r}`)).join(', ');
  return (
    <Gate testid="invite">
      <div class="stack" style={{ gap: '6px' }}>
        <h1>{info.kind === 'reset' ? t('auth.forgotTitle') : t('auth.inviteTitle')}</h1>
        <p class="gate-lead">{t(info.kind === 'reset' ? 'auth.resetLead' : 'auth.inviteLead', { name: info.name, garage: info.garage })}</p>
        {info.kind !== 'reset' && roles && <p class="muted small" style={{ margin: 0 }}>{t('auth.yourRoles', { roles })}</p>}
      </div>
      <Form onSubmit={() => undefined} class="stack">
        <Field label={t('auth.email')}><Input value={info.email} onValue={() => undefined} readOnly autoComplete="username" /></Field>
        <Field label={t('auth.newPassword')} hint={t('auth.newPasswordHint')}>
          <PasswordInput value={pw} onValue={setPw} autoComplete="new-password" autoFocus />
        </Field>
        <Field label={t('auth.confirmPassword')} error={error}>
          <PasswordInput value={pw2} onValue={setPw2} autoComplete="new-password" invalid={!!error} />
        </Field>
        <Button type="submit" variant="primary" block onClick={activate} data-testid="invite-submit">{t('auth.activate')}</Button>
      </Form>
    </Gate>
  );
}

export function NoAccessScreen() {
  const email = session.value?.user?.email || '';
  return (
    <Gate testid="no-access">
      <h1>{t('auth.noAccessTitle')}</h1>
      <p class="gate-lead">{t('auth.noAccessLead', { email })}</p>
      <Button variant="primary" block onClick={() => retryAccess()}>{t('auth.tryAgain')}</Button>
      <Button block onClick={() => signOut(true)}>{t('auth.otherAccount')}</Button>
    </Gate>
  );
}
