/* The installed app and its updates. A new version downloads quietly and is used the next time the app opens; nothing
   shows at the top of the screen. « Vérifier les mises à jour » (Réglages, Mon compte) looks for one on demand and offers
   « Mettre à jour maintenant ». Only an important version (a commit marked « [important] ») brings a notification. */
import { signal } from '@preact/signals';
import { APP_VERSION, BUILT_AT } from '../lib/config';
import { t } from '../lib/i18n';
import { toast } from '../ui';

/** a new version is downloaded and waits to be used */
export const updateReady = signal(false);
export type UpdateState = 'idle' | 'checking' | 'none' | 'ready' | 'offline' | 'error';
/** the last « Vérifier les mises à jour » */
export const updateState = signal<UpdateState>('idle');
export interface RemoteVersion { version: string; built_at: string | null; important_since: string | null; notes: string | null }
/** what the site says the latest version is (read from version.json) */
export const remoteVersion = signal<RemoteVersion | null>(null);

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

/* ---------- the version file ---------- */
export function parseRemote(j: unknown): RemoteVersion | null {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.version !== 'string' || !o.version) return null;
  const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return { version: o.version, built_at: s(o.built_at), important_since: s(o.important_since), notes: s(o.notes) };
}
/** another version than this one is published */
export function isNewer(v: RemoteVersion | null, mine = APP_VERSION): boolean {
  return !!v && v.version !== mine && v.version !== 'dev';
}
/** an important version came out after this one was made */
export function isImportant(v: RemoteVersion | null, builtAt = BUILT_AT): boolean {
  if (!v?.important_since || !builtAt) return false;
  const a = Date.parse(v.important_since), b = Date.parse(builtAt);
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
}
export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const v = parseRemote(await r.json());
    if (v) remoteVersion.value = v;
    return v;
  } catch {
    return null;
  }
}

/* ---------- the notification of an important version (once per version) ---------- */
const TOLD = 'his.update.told';
async function maybeNotify() {
  const v = (await fetchRemoteVersion()) || remoteVersion.value;
  if (!v || !isImportant(v)) return;
  try { if (localStorage.getItem(TOLD) === v.version) return; localStorage.setItem(TOLD, v.version); } catch { /* ignore */ }
  toast(t('shell.update.important'), { kind: 'info', ms: 20000, action: { label: t('shell.update.apply'), run: applyUpdate } });
}

export async function startPwa() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    doUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateReady.value = true;
        if (updateState.value === 'checking' || updateState.value === 'none') updateState.value = 'ready';
        void maybeNotify();
      },
      onRegisteredSW(_url, reg) {
        // look for a new version every hour, and when the app comes back to the screen
        if (!reg) return;
        registration = reg;
        setInterval(() => { void reg.update().catch(() => undefined); }, 60 * 60 * 1000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => undefined); });
      }
    });
  } catch { /* no service worker: the app still works online */ }
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

/** « Vérifier les mises à jour » */
export async function checkForUpdate(): Promise<UpdateState> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return (updateState.value = 'offline');
  updateState.value = 'checking';
  const v = await fetchRemoteVersion();
  if (updateReady.value) return (updateState.value = 'ready');
  const reg = registration;
  if (!reg) {
    // no service worker (a browser without it): a newer version is simply loaded again
    return (updateState.value = v ? (isNewer(v) ? 'ready' : 'none') : 'error');
  }
  try {
    await reg.update();
    const w = reg.installing || reg.waiting;
    if (w) await installed(w, 25000);
  } catch {
    return (updateState.value = v ? 'none' : 'error');
  }
  if (reg.waiting) updateReady.value = true;
  return (updateState.value = updateReady.value ? 'ready' : 'none');
}

/** « Mettre à jour maintenant » */
export function applyUpdate() {
  if (doUpdate && updateReady.value) void doUpdate(true);
  else location.reload();
}
