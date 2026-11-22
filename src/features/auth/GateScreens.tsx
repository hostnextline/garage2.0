/* Before the app: sign in, activate an invitation (or a new-password link), an account without access, the splash.
   The frame (App.tsx) imports them from here; each screen lives in its own file. */
import { t } from '../../lib/i18n';
import { session, signOut, retryAccess } from '../../data/auth';
import { Button } from '../../ui';
import { Gate } from './Gate';

export { Splash } from './Gate';
export { LoginScreen } from './LoginScreen';
export { InviteScreen } from './InviteScreen';

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
