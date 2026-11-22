/* « Me déconnecter », one flow for « Plus » and « Mon compte »: changes still waiting on the phone are said first (a
   second tap signs out all the same), and this device stops receiving the customers' texts as notifications (its
   push address is removed while the session can still remove it: after the sign-out the next person on that phone
   kept getting them). */
import { useState } from 'preact/hooks';
import { signOut } from '../../data/auth';
import { pendingCount } from '../../data/sync';
import { pushOff } from '../../services/push';
import { atMost, forgetAll } from './signOutHooks';

/* what the phone forgets besides the session (R104): the list lives in signOutHooks.ts (the frame fills it at start
   without bringing this file into the first download); `onSignOut` stays here too for whoever imports it from here */
export { onSignOut } from './signOutHooks';

/** signs out now: the push address first (best effort, 4 s at most), then the session, then what the phone kept of
    this person (one flow for « Plus » and « Mon compte ») */
export async function signOutNow(): Promise<void> {
  await atMost(pushOff(), 4000, 'sign-out:push');
  await signOut(true);
  await forgetAll();
}

/** the button's logic: { warn: changes waiting (0 = none said yet), out: the tap } */
export function useSignOut(): { warn: number; out: () => Promise<void> } {
  const [warn, setWarn] = useState(0);
  const out = async () => {
    if (!warn) {
      const n = await pendingCount();
      if (n > 0) { setWarn(n); return; }
    }
    await signOutNow();
  };
  return { warn, out };
}
