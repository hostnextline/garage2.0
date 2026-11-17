/* What the phone forgets at « Me déconnecter » besides the session (R104): the routes and team maps kept in memory,
   the reports kept on the phone… Their owners are above shared/app, so the frame registers them at start
   (src/app/signOutCleanup.ts) and signOut.ts runs them once the session is gone. A file of its own, with nothing but
   the list: the start of the app registers them without bringing the sign-out's code (and the push service's) into
   the first download. */
import { reportError } from '../../platform/report';

/** waits for `p` at most `ms` (a phone with no signal must still be able to sign out); a failure is reported, never thrown */
export function atMost(p: Promise<unknown>, ms: number, where: string): Promise<void> {
  return new Promise((res) => {
    const tm = setTimeout(res, ms);
    p.then(() => { clearTimeout(tm); res(); }, (e) => { clearTimeout(tm); reportError(e, where, 'action'); res(); });
  });
}

const cleanups: (() => unknown)[] = [];
/** something of this person the phone forgets at « Me déconnecter » (after the session is gone) */
export function onSignOut(fn: () => unknown): () => void {
  cleanups.push(fn);
  return () => { const i = cleanups.indexOf(fn); if (i >= 0) cleanups.splice(i, 1); };
}
/** runs every one of them, each 3 s at most; one that fails is reported and the others still run */
export async function forgetAll(): Promise<void> {
  await Promise.all(cleanups.map((fn) => {
    let r: unknown;
    try { r = fn(); } catch (e) { reportError(e, 'sign-out:forget', 'action'); return undefined; }
    return atMost(Promise.resolve(r), 3000, 'sign-out:forget');
  }));
}
