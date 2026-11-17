// @vitest-environment node
/* public/push-sw.js, run against a pretend worker: what an alert shows, what a tap does, a changed address (comms-guide-08,
   comms-guide-14). The file is plain JavaScript a phone keeps until it updates: its old behaviour stays. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const code = readFileSync(resolve(__dirname, '../../../public/push-sw.js'), 'utf8');
type H = (e: Record<string, unknown>) => void;

function worker(o: { windows?: { url: string; posted: unknown[]; focused: number }[]; sub?: unknown } = {}) {
  const on: Record<string, H> = {};
  const shown: { title: string; o: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const subscribed: unknown[] = [];
  let current = o.sub ?? null;
  const windows = (o.windows || []).map((w) => ({ url: w.url, postMessage: (m: unknown) => { w.posted.push(m); }, focus: async () => { w.focused++; } }));
  const self = {
    addEventListener: (k: string, f: H) => { on[k] = f; },
    registration: {
      scope: 'https://app.example/',
      showNotification: async (title: string, opt: Record<string, unknown>) => { shown.push({ title, o: opt }); },
      pushManager: {
        getSubscription: async () => current,
        subscribe: async (x: unknown) => { subscribed.push(x); current = { endpoint: 'new' }; return current; }
      }
    },
    clients: { matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } }
  };
  new Function('self', code)(self);
  const fire = async (k: string, e: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve();
    on[k]({ ...e, waitUntil: (p: Promise<unknown>) => { wait = p; } });
    await wait;
  };
  return { on, shown, opened, subscribed, fire };
}
const pushOf = (d: unknown) => ({ data: { json: () => d, text: () => JSON.stringify(d) } });

describe('the alert while the app is closed', () => {
  it('shows the server’s words as before, and keeps the number of a text', async () => {
    const w = worker();
    await w.fire('push', pushOf({ title: 'Nadia Roy', body: 'Une place demain ?', tag: 'texto-+15145550177' }));
    expect(w.shown[0].title).toBe('Nadia Roy');
    expect(w.shown[0].o).toMatchObject({ body: 'Une place demain ?', tag: 'texto-+15145550177', renotify: true, data: { url: 'https://app.example/', phone: '+15145550177' } });
    await w.fire('push', pushOf({ title: 'Appel entrant', body: 'Lara', tag: 'appel-+15145550177' }));
    expect((w.shown[1].o.data as { phone: unknown }).phone).toBeNull();
  });
  it('a tap with the app open: the app comes to the front and that number’s conversation is asked', async () => {
    const win = { url: 'https://app.example/#/today', posted: [] as unknown[], focused: 0 };
    const w = worker({ windows: [win] });
    await w.fire('notificationclick', { notification: { close: () => undefined, data: { url: 'https://app.example/', phone: '+15145550177' } } });
    expect(win.focused).toBe(1);
    expect(win.posted).toEqual([{ type: 'his-texto-open', phone: '+15145550177' }]);
    expect(w.opened).toEqual([]);
  });
  it('an alert shown by the old worker (no number), or a call: the app comes to the front, nothing asked', async () => {
    const win = { url: 'https://app.example/', posted: [] as unknown[], focused: 0 };
    const w = worker({ windows: [win] });
    await w.fire('notificationclick', { notification: { close: () => undefined, data: { url: 'https://app.example/' } } });
    expect(win.focused).toBe(1);
    expect(win.posted).toEqual([]);
  });
  it('a tap with the app closed opens it (the customer page never counts as the app)', async () => {
    const page = { url: 'https://app.example/client.html#t=1', posted: [] as unknown[], focused: 0 };
    const w = worker({ windows: [page] });
    await w.fire('notificationclick', { notification: { close: () => undefined, data: { url: 'https://app.example/', phone: '+15145550177' } } });
    expect(w.opened).toEqual(['https://app.example/']);
    expect(page.posted).toEqual([]);
  });
  it('the address changed: a new one is asked with the same key; one already given by the browser is left alone', async () => {
    const key = new Uint8Array([1, 2, 3]);
    const w = worker();
    await w.fire('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } } });
    expect(w.subscribed).toEqual([{ userVisibleOnly: true, applicationServerKey: key }]);
    const w2 = worker();
    await w2.fire('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } }, newSubscription: { endpoint: 'x' } });
    const w3 = worker({ sub: { endpoint: 'already' } });
    await w3.fire('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } } });
    const w4 = worker();
    await w4.fire('pushsubscriptionchange', {});
    expect([w2.subscribed, w3.subscribed, w4.subscribed]).toEqual([[], [], []]);
  });
});
