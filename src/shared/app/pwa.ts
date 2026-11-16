/* The installed app and its updates (the rules: version.ts).
   - A new version downloads quietly. The app puts it in place by itself when nothing can be lost: at start before the
     person touched anything, or back on the screen after 30 minutes away, with no sheet open, nothing typed, nothing
     being sent (a phone used to stay on an old version for days: a reload never activates a waiting worker).
   - An important version (« [important] ») shows a banner above every screen until it is installed.
   - A version older than the oldest one accepted (version.json `min_built_at`) shows one screen: « Mets l'app à jour ».
   - « Vérifier les mises à jour » (Réglages, Mon compte) looks on demand and offers « Mettre à jour maintenant »; a
     version still downloading is said so (never « à jour »).
   - Only the tab that asked reloads: another open tab says « installée : recharger » instead of losing what is typed. */
import { signal } from '@preact/signals';
import { layersOpen } from '../../platform/history';
import { reportError } from '../../platform/report';
import { net } from '../../data/sync';
import { parseRemote, isNewer, isImportant, isTooOld, mayApplyNow, checkVerdict, type RemoteVersion } from './version';

export { parseRemote, isNewer, isImportant, type RemoteVersion } from './version';

/** a new version is downloaded and waits to be used */
export const updateReady = signal(false);
export type UpdateState = 'idle' | 'checking' | 'none' | 'ready' | 'downloading' | 'offline' | 'error';
/** the last « Vérifier les mises à jour » */
export const updateState = signal<UpdateState>('idle');
/** what the site says the latest version is (read from version.json) */
export const remoteVersion = signal<RemoteVersion | null>(null);
/** another tab installed the new version: this one runs the old code until it reloads */
export const installedElsewhere = signal(false);

/* the browser offers « Installer l'app » once, early (before any screen loads): kept here for the guide's button */
export interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
export const installEvent = signal<InstallEvent | null>(null);
export const appInstalled = signal(false);
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent.value = e as InstallEvent; });
  window.addEventListener('appinstalled', () => { installEvent.value = null; appInstalled.value = true; });
}
let doUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | null = null;
/** this tab asked for the new version: it reloads when the new worker takes over (the others do not) */
let askedHere = false;

/** an important version waits: the banner above every screen (until it is installed) */
export function importantWaiting(): boolean {
  return updateReady.value && isImportant(remoteVersion.value);
}
/** this version is too old to go on */
export function mustUpdate(): boolean { return isTooOld(remoteVersion.value); }

/* ---------- the version file ---------- */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const tm = setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    p.then((v) => { clearTimeout(tm); res(v); }, (e) => { clearTimeout(tm); rej(e); });
  });
}
export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const r = await withTimeout(fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' }), 15000);
    if (!r.ok) return null;
    const v = parseRemote(await r.json());
    if (v) remoteVersion.value = v;
    return v;
  } catch {
    return null;   // no signal, or not a version file: the answer is « unknown », said by the caller
  }
}

/* ---------- putting a waiting version in place ---------- */
const APPLIED = 'his.update.applied';
function appliedBefore(v: string): boolean { try { return sessionStorage.getItem(APPLIED) === v; } catch { return false; } }
function remember(v: string) { try { sessionStorage.setItem(APPLIED, v); } catch { /* private mode: at most one more reload */ } }
let touched = false;
let hiddenAt = 0;
function typing(): boolean {
  const a = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
function tryApply(moment: 'start' | 'resume', awayMs: number) {
  const v = remoteVersion.value?.version || 'next';
  const ok = mayApplyNow({ ready: updateReady.value, moment, awayMs, layersOpen: layersOpen.value, typing: typing(), sending: !!net.value.sending, appliedBefore: appliedBefore(v), touched });
  if (ok) { remember(v); applyUpdate(); }
}

export async function startPwa() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  const bootAt = Date.now();
  document.addEventListener('pointerdown', () => { touched = true; }, { capture: true, once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt) { tryApply('resume', Date.now() - hiddenAt); hiddenAt = 0; }
  });
  try {
    const { registerSW } = await import('virtual:pwa-register');
    doUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateReady.value = true;
        if (updateState.value === 'checking' || updateState.value === 'none' || updateState.value === 'downloading') updateState.value = 'ready';
        void fetchRemoteVersion().then(() => { if (Date.now() - bootAt < 15000) tryApply('start', 0); });
      },
      onNeedReload() {
        // the new worker took over: the tab that asked reloads; another one keeps what is typed and offers to reload
        if (askedHere) location.reload();
        else installedElsewhere.value = true;
      },
      onRegisteredSW(_url, reg) {
        // look for a new version every hour while the app is on the screen, and when it comes back to the screen
        if (!reg) return;
        registration = reg;
        const look = () => { void reg.update().catch(() => undefined); };
        setInterval(() => { if (document.visibilityState === 'visible') look(); }, 60 * 60 * 1000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
        void fetchRemoteVersion();
      },
      onRegisterError(e) { reportError(e, 'service-worker', 'boot'); }
    });
  } catch (e) {
    // no service worker: the app still works online
    reportError(e, 'service-worker', 'boot');
  }
}

/** waits until a new version being downloaded is ready (or gives up) */
function installed(w: ServiceWorker, ms: number): Promise<void> {
  return new Promise((res) => {
    if (w.state === 'installed' || w.state === 'activated') { res(); return; }
    const done = () => { clearTimeout(timer); w.removeEventListener('statechange', on); res(); };
    const on = () => { if (w.state === 'installed' || w.state === 'activated' || w.state === 'redundant') done(); };
    const timer = setTimeout(done, ms);
    w.addEventListener('statechange', on);
  });
}

let checking: Promise<UpdateState> | null = null;
/** « Vérifier les mises à jour » (a second tap while it looks waits for the same answer) */
export function checkForUpdate(): Promise<UpdateState> {
  if (!checking) checking = check().finally(() => { checking = null; });
  return checking;
}
async function check(): Promise<UpdateState> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return (updateState.value = 'offline');
  updateState.value = 'checking';
  const v = await fetchRemoteVersion();
  if (updateReady.value) return (updateState.value = 'ready');
  const reg = registration;
  if (!reg) {
    // no service worker (a browser without it): a newer version is simply loaded again
    return (updateState.value = v ? (isNewer(v) ? 'ready' : 'none') : 'error');
  }
  let failed = false;
  try {
    await withTimeout(reg.update(), 20000);
    const w = reg.installing || reg.waiting;
    if (w) await installed(w, 25000);
  } catch {
    failed = true;
  }
  if (reg.waiting) updateReady.value = true;
  const verdict = checkVerdict({ remote: v, waiting: updateReady.value, failed });
  // still downloading: the answer flips to « prête » by itself when the download ends (onNeedRefresh)
  return (updateState.value = verdict);
}

/** « Mettre à jour maintenant » */
export function applyUpdate() {
  askedHere = true;
  if (doUpdate && updateReady.value) void doUpdate(true);
  else location.reload();
}
