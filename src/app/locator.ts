/* The positions still missing are found here, in the background, without asking anyone: customers and coming
   appointments whose address was typed without choosing a suggestion, or saved with no network (« la position sera
   trouvée plus tard »). Runs on the phones of the people who book (they may change a customer and an appointment),
   once the phone's copy of the data is ready, then every 10 minutes and when the network comes back; « Chercher »
   on a customer, an appointment or the map asks for it at once.
   One address at a time, gently with the free map service; only a sure answer is saved (locate.ts: the same door,
   street and town). An address that gave nothing is tried again after 6 hours, or as soon as it is changed. */
import { signal } from '@preact/signals';
import { allJobs, customersList } from '../data/select';
import { saveCustomer, updateJob } from '../data/api';
import { net } from '../data/sync';
import { today } from '../lib/dates';
import { locate } from '../features/customers/locate';
import type { Customer, Job } from '../data/types';
import { may } from './routes';

export interface Task {
  /** the address folded: one lookup for the same address written on a customer and its appointments */
  key: string; address: string; postal: string | null; city: string | null;
  customerId: string | null; jobIds: string[];
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const addrKey = (a: string | null | undefined) => fold(String(a || '')).replace(/[^a-z0-9]+/g, ' ').trim();
const COMING = new Set(['booked', 'en_route', 'on_site']);

/** where a coming appointment is: its own address, or its customer's when it has none (or the same one) */
export function jobPlace(j: Pick<Job, 'address' | 'lat' | 'lng' | 'postal_code'>, c: Customer | undefined): { address: string; postal: string | null; city: string | null; lat: number | null; lng: number | null; home: boolean } {
  const own = (j.address || '').trim();
  const home = !own || (!!c && addrKey(own) === addrKey(c.address));
  if (home && c) return { address: (c.address || own).trim(), postal: c.postal_code || j.postal_code || null, city: c.city || null, lat: j.lat ?? c.lat, lng: j.lng ?? c.lng, home: true };
  return { address: own, postal: j.postal_code || null, city: null, lat: j.lat, lng: j.lng, home: false };
}

/** what has no position yet: the coming appointments first (today on, nearest day first), then the customers;
    one task per address. `only` keeps the given appointments and customers (« Chercher »). */
export function missingPositions(jobs: Job[], customers: Customer[], day: string, only?: { jobs?: string[]; customers?: string[] }): Task[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const tasks = new Map<string, Task>();
  const add = (address: string, postal: string | null, city: string | null, customerId: string | null, jobId: string | null) => {
    const key = addrKey(address);
    if (!key || !/[a-z]/.test(key)) return;
    let t = tasks.get(key);
    if (!t) { t = { key, address: address.trim(), postal, city, customerId: null, jobIds: [] }; tasks.set(key, t); }
    if (customerId && !t.customerId) t.customerId = customerId;
    if (jobId && !t.jobIds.includes(jobId)) t.jobIds.push(jobId);
    if (!t.postal && postal) t.postal = postal;
    if (!t.city && city) t.city = city;
  };
  const coming = jobs
    .filter((j) => !j.deleted_at && j.day >= day && COMING.has(j.status) && j.lat == null && (!only || !!only.jobs?.includes(j.id)))
    .sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number);
  for (const j of coming) {
    const c = j.customer_id ? byId.get(j.customer_id) : undefined;
    const p = jobPlace(j, c);
    if (!p.address) continue;
    if (p.home) {
      if (c && c.lat != null) continue;                     // the customer's position is known: the appointment uses it
      add(p.address, p.postal, p.city, c ? c.id : null, j.id);
    } else add(p.address, p.postal, null, null, j.id);
  }
  for (const c of customers) {
    if (c.deleted_at || c.lat != null || !c.address?.trim()) continue;
    if (only && !only.customers?.includes(c.id)) continue;
    add(c.address, c.postal_code, c.city, c.id, null);
  }
  return [...tasks.values()];
}

/* ---------- addresses already tried (this phone) ---------- */
const TRIED = 'his.locate.tried';
const AGAIN_MS = 6 * 3600_000;
function tried(): Record<string, number> {
  try { const x = JSON.parse(localStorage.getItem(TRIED) || '{}'); return x && typeof x === 'object' ? x : {}; } catch { return {}; }
}
function markTried(key: string) {
  try {
    const all = tried();
    const now = Date.now();
    for (const k of Object.keys(all)) if (now - all[k] > 7 * 86400_000) delete all[k];
    all[key] = now;
    localStorage.setItem(TRIED, JSON.stringify(all));
  } catch { /* the address is tried again next time */ }
}
function forget(key: string) {
  try { const all = tried(); delete all[key]; localStorage.setItem(TRIED, JSON.stringify(all)); } catch { /* nothing kept */ }
}

/* ---------- finding them ---------- */
export interface LocateRun {
  found: number; missing: number; offline: boolean;
  /** the appointments placed by this run, with their new position (the map shows them at once) */
  placed: Record<string, { lat: number; lng: number }>;
}
/** the locator now: busy, and what the last run did */
export const locator = signal<{ busy: boolean; last: LocateRun | null }>({ busy: false, last: null });
let running: Promise<LocateRun> | null = null;
let runs = 0;
// the state on the page itself (data-locator = busy | idle, data-locator-runs): the end-to-end test waits for a run
// to be through instead of guessing how many seconds the machine needs
function tell(state: 'busy' | 'idle') {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.locator = state;
  document.documentElement.dataset.locatorRuns = String(runs);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** looks for the positions still missing (or only `only`); `force` tries again the addresses tried lately */
export function locateMissing(opts: { only?: { jobs?: string[]; customers?: string[] }; force?: boolean; max?: number } = {}): Promise<LocateRun> {
  if (running) return running.then(() => (opts.only || opts.force ? locateMissing(opts) : (locator.value.last as LocateRun)));
  running = (async () => {
    locator.value = { ...locator.value, busy: true };
    tell('busy');
    const seen = tried();
    const all = missingPositions(allJobs.value, customersList.value, today(), opts.only);
    const tasks = all.filter((t) => opts.force || !(seen[t.key] && Date.now() - seen[t.key] < AGAIN_MS)).slice(0, opts.max ?? 40);
    const run: LocateRun = { found: 0, missing: all.length, offline: false, placed: {} };
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (i) await wait(1100);                                 // gently with the free map service
      const r = await locate(t.address, { postal: t.postal, city: t.city, fresh: opts.force });
      if (r.status === 'offline') { run.offline = true; break; }
      if (r.status !== 'found') { markTried(t.key); continue; }
      const pl = r.place.place;
      try {
        if (t.customerId) {
          const c = customersList.value.find((x) => x.id === t.customerId);
          if (c && c.lat == null) await saveCustomer({ id: c.id, lat: pl.lat, lng: pl.lng, ...(c.city ? {} : { city: pl.city ?? null }) });
        }
        for (const id of t.jobIds) {
          const j = allJobs.value.find((x) => x.id === id);
          if (j && j.lat == null) await updateJob(id, { lat: pl.lat, lng: pl.lng });
          if (pl.lat != null && pl.lng != null) run.placed[id] = { lat: pl.lat, lng: pl.lng };
        }
        forget(t.key);
        run.found++;
        run.missing--;
      } catch {
        markTried(t.key);                                      // refused (rights) or kept for later: not again soon
      }
    }
    locator.value = { busy: false, last: run };
    runs++;
    tell('idle');
    return run;
  })().finally(() => { running = null; });
  return running;
}

/** for the people who book: once the data is ready, every 10 minutes, and when the network comes back */
let started = false;
export function startLocator() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const go = () => { if (net.value.ready && navigator.onLine !== false && may.book()) void locateMissing(); };
  const first = setInterval(() => { if (net.value.ready) { clearInterval(first); setTimeout(go, 4000); } }, 1000);
  setInterval(go, 10 * 60_000);
  window.addEventListener('online', () => setTimeout(go, 3000));
}

/** a customer's position was just found: its coming appointments at the same address take it too */
export async function spreadToJobs(customerId: string, lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return;
  const c = customersList.value.find((x) => x.id === customerId);
  for (const j of allJobs.value) {
    if (j.customer_id !== customerId || j.lat != null || !COMING.has(j.status) || j.day < today()) continue;
    if (!jobPlace(j, c).home) continue;
    try { await updateJob(j.id, { lat, lng }); } catch { /* the appointment still uses the customer's position */ }
  }
}
