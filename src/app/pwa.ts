/* The installed app: a new version is announced in a banner (« Mettre à jour »), never forced in the middle of a job. */
import { signal } from '@preact/signals';

export const updateReady = signal(false);

/* the browser offers « Installer l'app » once, early (before any screen loads): kept here for the guide's button */
export interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
export const installEvent = signal<InstallEvent | null>(null);
export const appInstalled = signal(false);
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent.value = e as InstallEvent; });
  window.addEventListener('appinstalled', () => { installEvent.value = null; appInstalled.value = true; });
}
let doUpdate: ((reload?: boolean) => Promise<void>) | null = null;

export async function startPwa() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    doUpdate = registerSW({
      immediate: true,
      onNeedRefresh() { updateReady.value = true; },
      onRegisteredSW(_url, reg) {
        // look for a new version every hour, and when the app comes back to the screen
        if (!reg) return;
        setInterval(() => { void reg.update().catch(() => undefined); }, 60 * 60 * 1000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => undefined); });
      }
    });
  } catch { /* no service worker: the app still works online */ }
}
export function applyUpdate() {
  if (doUpdate) void doUpdate(true);
  else location.reload();
}
