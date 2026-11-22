/* The start of the team app, after the first picture is drawn (main.tsx): the demo (dev only), the way back from
   Google, the session; then the update flow. The auth watcher always starts, also after a Google sign-in (it used to
   be skipped then: a later sign-out or refused session went unnoticed). Whatever fails is reported and the app says
   « Recharger » instead of a splash for ever. Tested in boot.test.ts with pretend steps. */
export interface BootSteps {
  demo: boolean;
  startDemo: () => Promise<void>;
  finishOAuth: () => Promise<boolean>;
  startAuth: () => Promise<void>;
  startPwa: () => Promise<void>;
  report: (e: unknown) => void;
  failed: () => void;
}
export async function runBoot(s: BootSteps): Promise<void> {
  try {
    if (s.demo) {
      await s.startDemo();
    } else {
      // back from Google: the code is exchanged first; the session watcher starts in every case
      await s.finishOAuth().catch((e) => { s.report(e); return false; });
      await s.startAuth();
    }
  } catch (e) {
    s.report(e);
    s.failed();
    return;
  }
  try { await s.startPwa(); } catch (e) { s.report(e); }
}
/** « ?demo » in the address (before or after the « # ») */
export function wantsDemo(search: string, hash: string): boolean {
  return /[?&]demo\b/.test(search) || /[?&]demo\b/.test(hash);
}
