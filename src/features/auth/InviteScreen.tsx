/* The invitation link (or a « Nouveau mot de passe » link): the server says who it is for, the person chooses a password,
   then is signed in. Without signal the link is kept and « Réessayer » asks again (a new employee in a parking lot does
   not lose it); only a real refusal (expired, already used) sends to the sign-in screen. */
import { useEffect, useState } from 'preact/hooks';
import { t, setLang } from '../../lib/i18n';
import { errorMessage } from '../../lib/errors';
import { signIn, session, signOut, inviteToken, clearInvite, authState, callFn } from '../../data/auth';
import { Button, Field, Input, Form, Banner } from '../../ui';
import { Gate, PasswordInput } from './Gate';
import { gateNotice } from './notice';
import { signInWords, linkTrouble } from './words';

interface InviteInfo { name: string; email: string; roles: string[]; kind: 'invite' | 'reset'; lang: 'fr' | 'en'; garage: string }
type Problem = { text: string; network: boolean };

export function InviteScreen() {
  const token = inviteToken.value || '';
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [tries, setTries] = useState(0);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signedAs = session.value?.user?.email || null;
  useEffect(() => {
    let alive = true;
    setProblem(null);
    callFn<InviteInfo>('team', { action: 'invite-info', token }).then((r) => {
      if (!alive) return;
      if (r.ok) { setInfo(r); if (r.lang === 'en' || r.lang === 'fr') setLang(r.lang); }
      else setProblem({ text: errorMessage(r), network: false });
    }, (e) => { if (alive) setProblem({ text: errorMessage(e), network: linkTrouble(e) === 'network' }); });
    return () => { alive = false; };
  }, [token, tries]);
  const leave = () => { clearInvite(); authState.value = session.value ? 'ready' : 'signed_out'; };
  if (problem) {
    return (
      <Gate testid="invite">
        <h1>{t('auth.linkProblem')}</h1>
        <Banner kind="warn">{problem.text}</Banner>
        {problem.network
          ? <Button variant="primary" block onClick={() => setTries(tries + 1)} data-testid="invite-retry">{t('common.retry')}</Button>
          : <Button variant="primary" block onClick={leave}>{t('auth.toSignIn')}</Button>}
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
    let r: { ok: boolean; email?: string; code?: string; error?: string };
    try { r = await callFn<{ email: string }>('team', { action: 'invite-accept', token, password: pw }); }
    catch (e) { setError(errorMessage(e)); return; }
    if (!r.ok) { setError(errorMessage(r)); return; }
    clearInvite();
    authState.value = 'loading';
    const err = await signIn(r.email || info.email, pw);
    // this screen is gone by now: the sign-in screen tells the person the password is chosen, and why signing in failed
    if (err) { gateNotice.value = `${t('auth.passwordSet')} ${signInWords(err)}`; authState.value = 'signed_out'; }
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
