/* « Connexion »: e-mail and password (the e-mail of the last sign-in is filled in), Google when the server offers it,
   « Mot de passe oublié » (a link by e-mail or text). A word left by the invitation screen shows on top. */
import { useEffect, useState } from 'preact/hooks';
import { LogIn, KeyRound } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { EMAIL_RE } from '../../lib/text';
import { errorMessage } from '../../lib/errors';
import { appBase } from '../../lib/config';
import { signIn, googleEnabled, signInGoogle, callFn } from '../../data/auth';
import { Button, Field, Input, Form, Banner, Sheet } from '../../ui';
import { MovedBanner } from '../../shared/app/moved';
import { Gate, PasswordInput } from './Gate';
import { gateNotice } from './notice';
import { signInWords } from './words';

export function LoginScreen() {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('his.email') || ''; } catch { return ''; } });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const [forgot, setForgot] = useState(false);
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  useEffect(() => {
    let alive = true;
    void googleEnabled().then((on) => { if (alive) setGoogle(on); });
    return () => { alive = false; };
  }, []);
  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) { setError(t('auth.missing')); return; }
    gateNotice.value = null;
    const r = await signIn(email, password);
    if (r) setError(signInWords(r));
  };
  return (
    <Gate testid="login">
      <MovedBanner />
      <div class="stack" style={{ gap: '6px' }}>
        <h1>{t('auth.title')}</h1>
        <p class="gate-lead">{t('auth.lead')}</p>
      </div>
      {gateNotice.value && <Banner kind="warn">{gateNotice.value}</Banner>}
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
    setError(null);
    try {
      const r = await callFn('team', { action: 'forgot', email: email.trim(), base: appBase(), lang: lang.value });
      if (!r.ok && r.code !== undefined && r.code !== 'not_found') { setError(errorMessage(r)); return; }
      setSent(true);
    } catch (e) {
      // no signal: say so under the field (the button would otherwise just stop turning)
      setError(errorMessage(e));
    }
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
