/* « Me déconnecter », one flow for « Plus » and « Mon compte »: changes still waiting on the phone are said first (a
   second tap signs out all the same), and this device stops receiving the customers' texts as notifications (its
   push address is removed while the session can still remove it: after the sign-out the next person on that phone
   kept getting them). */
import { useState } from 'preact/hooks';
import { signOut } from '../../data/auth';
import { pendingCount } from '../../data/sync';
import { reportError } from '../../platform/report';
import { pushOff } from '../../services/push';

/** waits for `p` at most `ms` (a phone with no signal must still be able to sign out) */
function atMost(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((res) => {
    const tm = setTimeout(res, ms);
    p.then(() => { clearTimeout(tm); res(); }, (e) => { clearTimeout(tm); reportError(e, 'sign-out:push', 'action'); res(); });
  });
}

/** signs out now: the push address first (best effort, 4 s at most), then the session */
export async function signOutNow(): Promise<void> {
  await atMost(pushOff(), 4000);
  await signOut(true);
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
