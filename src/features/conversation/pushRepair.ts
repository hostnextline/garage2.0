/* « Texto entrant » and « Appel entrant », the alert while the app is closed: give the server a working address again
   when it lost this device's (comms-guide-08).
   The alert stopped without a word when the server no longer had this device's address while the device still had it:
   the server function « ring » drops a row when the push service answers that the address is dead (404 / 410), the
   maker's notification service gave the device a new address (the worker takes it: public/push-sw.js), or a takeover.
   The switch in Réglages read « off » only if somebody went to look.
   Now, each time the app starts for an owner who takes the texts or the calls, a device that still holds an address (it
   was switched on here, and never switched off: « off » and the sign-out drop the address itself) with the permission
   given is checked. Server does not know that address: the old one is most likely dead (giving it back would only get it
   dropped again at the next text, and so on at every start), so the device asks a NEW address with the garage's key and
   gives that one to the server. Nothing is asked (the permission is already there). When the device cannot get a new
   address, it is left with none (Réglages reads « off ») and the person is told once. No address on the device, or no
   permission: left as it is (only « Activer » in Réglages may ask). */
import { sb, callFn } from '../../data/auth';
import { reportError } from '../../platform/report';
import { t } from '../../lib/i18n';
import { toast } from '../../ui';

type Sub = { endpoint: string; toJSON(): { endpoint?: string; keys?: Record<string, string> } };
export type RepairWorld = {
  /** the permission for notifications on this device (null: no notifications here) */
  permission: () => string | null;
  /** this device's push address, if it has one */
  subscription: () => Promise<Sub | null>;
  /** does the server know this address for the person signed in? */
  known: (endpoint: string) => Promise<boolean>;
  /** the garage's public key (server function « ring », push-key); throws when the server does not give it */
  key: () => Promise<string>;
  /** drops this device's address and asks a new one with that key; throws when the device refuses */
  renew: (key: string) => Promise<Sub>;
  /** gives the address to the server */
  add: (row: { endpoint: string; p256dh: string; auth: string }) => Promise<void>;
};

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const s = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration().catch(() => undefined)) || null;
}

const browser: RepairWorld = {
  permission: () => (typeof Notification !== 'undefined' ? Notification.permission : null),
  subscription: async () => {
    const reg = await registration();
    return reg?.pushManager ? reg.pushManager.getSubscription() : null;
  },
  known: async (endpoint) => {
    const { data, error } = await sb.from('push_subs').select('id').eq('endpoint', endpoint).limit(1);
    if (error) throw error;
    return !!data && data.length > 0;
  },
  key: async () => {
    const r = await callFn<{ key?: string }>('ring', { action: 'push-key' }, 20000);
    if (!r.ok || !r.key) throw new Error(r.error || 'push-key');
    return r.key;
  },
  renew: async (key) => {
    const reg = await registration();
    if (!reg?.pushManager) throw new Error('no push manager');
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  },
  add: async (row) => {
    const { error } = await sb.from('push_subs').insert(row);
    if (error) throw error;
  }
};

const rowOf = (s: Sub) => {
  const j = s.toJSON();
  return j.endpoint && j.keys?.p256dh && j.keys?.auth ? { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } : null;
};

/** 'kept': the server knows this device; 'renewed': a new address was given to the server; 'lost': the device could not
    get a new one (it has none now: Réglages reads « off »); 'nothing': no address or no permission */
export async function repairPush(w: RepairWorld = browser): Promise<'kept' | 'renewed' | 'lost' | 'nothing'> {
  if (w.permission() !== 'granted') return 'nothing';
  const sub = await w.subscription();
  if (!sub) return 'nothing';
  const had = rowOf(sub);
  if (!had) return 'nothing';
  if (await w.known(had.endpoint)) return 'kept';
  // the key first: no key (no signal, the server in trouble) and nothing on the device is touched, the next start tries again
  const key = await w.key();
  let row: ReturnType<typeof rowOf>;
  try { row = rowOf(await w.renew(key)); } catch (e) { reportError(e, 'push:repair:renew', 'error'); return 'lost'; }
  if (!row) return 'lost';
  await w.add(row);
  return 'renewed';
}

let tried: string | null = null;
/** once per person and per page: the start of the app calls it (never an error for the screen; a lost alert said once) */
export function repairPushOnce(who: string, w?: RepairWorld, tell: (words: string) => void = (words) => { toast(words, { kind: 'bad' }); }): Promise<void> {
  if (tried === who) return Promise.resolve();
  tried = who;
  return repairPush(w).then((r) => { if (r === 'lost') tell(t('conversation.alertLost')); }, (e) => reportError(e, 'push:repair', 'error'));
}
