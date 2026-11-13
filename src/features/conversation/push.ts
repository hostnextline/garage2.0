/* The alert while the app is closed (« Texto entrant »): this device asks its maker's notification service for an address,
   and gives it to the server (table push_subs); the server function « ring » then sends each new text there, and the
   service worker (public/push-sw.js) shows it. Per device: to do again on each phone or computer that should be told. */
import { sb, callFn } from '../../data/auth';

/** on / off on this device; « denied »: notifications are blocked for the app in the device's settings; « install »: an
    iPhone or iPad where the app is not on the home screen yet (Apple only alerts an installed app); « unsupported » */
export type PushState = 'on' | 'off' | 'denied' | 'install' | 'unsupported';

function bytes(b64u: string): Uint8Array<ArrayBuffer> {
  const t = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** what this device can do, from what the browser says (pure: tested) */
export function pushAbility(w: { sw: boolean; push: boolean; notif: boolean; permission: string | null; ios: boolean; standalone: boolean }): 'ok' | 'denied' | 'install' | 'unsupported' {
  if (!w.sw || !w.push || !w.notif) return w.ios && !w.standalone ? 'install' : 'unsupported';
  return w.permission === 'denied' ? 'denied' : 'ok';
}
function ability() {
  const ua = navigator.userAgent || '';
  return pushAbility({
    sw: 'serviceWorker' in navigator, push: 'PushManager' in window, notif: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : null,
    ios: /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  });
}
async function registration(): Promise<ServiceWorkerRegistration | null> {
  try { return (await navigator.serviceWorker.getRegistration()) || null; } catch { return null; }
}
export async function pushState(): Promise<PushState> {
  const a = ability();
  if (a !== 'ok') return a;
  const reg = await registration();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return 'off';
  const { data } = await sb.from('push_subs').select('id').eq('endpoint', sub.endpoint).limit(1);
  return data && data.length ? 'on' : 'off';
}
/** asks the permission, then tells the server where to alert this device. Throws { code: 'denied' | 'unsupported' } */
export async function pushOn(): Promise<void> {
  const can = ability();
  if (can === 'unsupported' || can === 'install') throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  // asked FIRST, before anything is awaited: Safari (Mac and iPhone) only shows the question while it still knows the
  // person just pressed something; after a wait it refuses without asking
  const asked = Notification.requestPermission();
  const reg = await registration();
  if ((await asked) !== 'granted') throw Object.assign(new Error('denied'), { code: 'denied' });
  if (!reg) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  const r = await callFn<{ key?: string }>('ring', { action: 'push-key' }, 20000);
  if (!r.ok || !r.key) throw new Error(r.error || 'push-key');
  const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(r.key!) });
  let sub: PushSubscription;
  // an address made for another key (the garage's key was changed): ask for a new one
  try { sub = await ask(); } catch { await (await reg.pushManager.getSubscription())?.unsubscribe(); sub = await ask(); }
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error('push-keys');
  await sb.from('push_subs').delete().eq('endpoint', j.endpoint);
  const { error } = await sb.from('push_subs').insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw error;
}
export async function pushOff(): Promise<void> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await sb.from('push_subs').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
