/* « Reconnecte-toi »: the session was lost (expired, refused) while changes wait on the phone. The person signs in
   again here, over the screen they were on: nothing is thrown away, the changes go out once the session is back.
   Only as the same account: the e-mail of the lost session is fixed (changes made by one person never go out under
   another's name); someone else signs out from « Plus » first. */
import { useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { LogIn } from 'lucide-preact';
import { t } from '../lib/i18n';
import { signIn, me } from '../data/auth';
import { Sheet, Form, Field, Input, Button } from '../ui';

export const reconnectOpen = signal(false);

function lastEmail(): string {
  const mine = (me.value as { email?: string | null } | null)?.email;
  if (mine) return mine;
  try { return localStorage.getItem('his.email') || ''; } catch { return ''; }
}

export function ReconnectSheet() {
  if (!reconnectOpen.value) return null;
  return <ReconnectForm />;
}
function ReconnectForm() {
  // the account whose changes wait: known = the field cannot be changed
  const [locked] = useState(lastEmail);
  const [email, setEmail] = useState(locked);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => { reconnectOpen.value = false; };
  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) { setError(t('auth.missing')); return; }
    const r = await signIn(locked || email, password);
    // signIn answers a dictionary key (« auth.wrong ») or the server's own sentence
    if (r) setError(r.includes('.') && !r.includes(' ') ? t(r) : r);
    else close();
  };
  return (
    <Sheet open onClose={close} title={t('shell.session.signIn')} sub={t('shell.session.lead')} data-testid="reconnect-sheet">
      <Form onSubmit={() => undefined} class="stack">
        <Field label={t('auth.email')}>
          <Input type="email" inputMode="email" autoComplete="username" value={locked || email} onValue={setEmail} readOnly={!!locked} data-testid="reconnect-email" />
        </Field>
        <Field label={t('auth.password')} error={error}>
          <Input type="password" autoComplete="current-password" value={password} onValue={setPassword} invalid={!!error} autoFocus />
        </Field>
        <Button type="submit" variant="primary" block icon={<LogIn size={20} />} onClick={submit} data-testid="reconnect-submit">{t('auth.signIn')}</Button>
      </Form>
    </Sheet>
  );
}
