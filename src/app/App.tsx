/* What is on the screen: the splash while starting, the sign-in screens, or the app. */
import { authState } from '../data/auth';
import { Shell } from './Shell';
import { Splash, LoginScreen, InviteScreen, NoAccessScreen } from '../features/auth/GateScreens';
import { ToastHost, AskHost } from '../ui';

export function App() {
  const s = authState.value;
  return (
    <>
      {s === 'loading' ? <Splash /> : s === 'invite' ? <InviteScreen /> : s === 'signed_out' ? <LoginScreen /> : s === 'no_access' ? <NoAccessScreen /> : <Shell />}
      <AskHost />
      <ToastHost />
    </>
  );
}
