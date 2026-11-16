/* The width of the screen, for the few things that change between phone and computer (week vs day…).
   Layout itself is done in CSS. */
import { signal } from '@preact/signals';

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 960px)') : null;
/** a computer or a large tablet (≥ 960 px) */
export const wide = signal<boolean>(!!mq?.matches);
mq?.addEventListener?.('change', (e) => { wide.value = e.matches; });

const coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
/** a finger rather than a mouse */
export const touch = signal<boolean>(!!coarse?.matches);
coarse?.addEventListener?.('change', (e) => { touch.value = e.matches; });

/* The agenda's own width rule: the time grid (15-minute units) needs room, so it is drawn from 760 px; under that
   (phones) the day stays a list per truck. */
const mqRoomy = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 760px)') : null;
/** wide enough for the time grid (≥ 760 px) */
export const roomy = signal<boolean>(!!mqRoomy?.matches);
mqRoomy?.addEventListener?.('change', (e) => { roomy.value = e.matches; });

/* What the phone itself says about the network and the screen: the 'offline' event comes at once, long before a
   request fails (the sync chip used to wait for the next failed pull, up to 3 minutes). */
const nav = typeof navigator !== 'undefined' ? navigator : undefined;
/** the phone says it has a network (false: certainly offline; true: maybe online) */
export const browserOnline = signal<boolean>(nav?.onLine !== false);
/** the app is on the screen (timers that only matter to someone looking check it) */
export const pageVisible = signal<boolean>(typeof document === 'undefined' || document.visibilityState !== 'hidden');
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { browserOnline.value = true; });
  window.addEventListener('offline', () => { browserOnline.value = false; });
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { pageVisible.value = document.visibilityState !== 'hidden'; });
}
