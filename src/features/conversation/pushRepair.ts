/* « Texto entrant », the alert while the app is closed: put back the address the server lost (comms-guide-08).
   The alert stopped without a word when the server no longer had this device's address while the device still had it:
   the maker's notification service gave the device a new address (the worker takes it: public/push-sw.js), the server
   dropped the row after one refusal, or a takeover. The switch in Réglages read « off » only if somebody went to look.
   Now, each time the bubbles start for an owner who takes the texts, a device that still holds an address (it was
   switched on here, and never switched off: « off » and the sign-out drop the address itself) with the permission
   given gets its row back. Nothing is asked, nothing is shown: no address on the device, or no permission, is left
   as it is (only « Activer » in Réglages may ask). */
import { sb } from '../../data/auth';
import { reportError } from '../../platform/report';

type Sub = { endpoint: string; toJSON(): { endpoint?: string; keys?: Record<string, string> } };
export type RepairWorld = {
  /** the permission for notifications on this device (null: no notifications here) */
  permission: () => string | null;
  /** this device's push address, if it has one */
  subscription: () => Promise<Sub | null>;
  /** does the server know this address for the person signed in? */
  known: (endpoint: string) => Promise<boolean>;
  /** gives the address to the server again */
  add: (row: { endpoint: string; p256dh: string; auth: string }) => Promise<void>;
};

const browser: RepairWorld = {
  permission: () => (typeof Notification !== 'undefined' ? Notification.permission : null),
  subscription: async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    return reg?.pushManager ? reg.pushManager.getSubscription() : null;
  },
  known: async (endpoint) => {
    const { data, error } = await sb.from('push_subs').select('id').eq('endpoint', endpoint).limit(1);
    if (error) throw error;
    return !!data && data.length > 0;
  },
  add: async (row) => {
    const { error } = await sb.from('push_subs').insert(row);
    if (error) throw error;
  }
};

/** 'kept': the server knows this device; 'put back': its row was given again; 'nothing': no address or no permission */
export async function repairPush(w: RepairWorld = browser): Promise<'kept' | 'put back' | 'nothing'> {
  if (w.permission() !== 'granted') return 'nothing';
  const sub = await w.subscription();
  if (!sub) return 'nothing';
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return 'nothing';
  if (await w.known(j.endpoint)) return 'kept';
  await w.add({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  return 'put back';
}

let tried: string | null = null;
/** once per person and per page: the bubbles' start calls it (never an error for the screen) */
export function repairPushOnce(who: string, w?: RepairWorld): void {
  if (tried === who) return;
  tried = who;
  void repairPush(w).catch((e) => reportError(e, 'push:repair', 'error'));
}
