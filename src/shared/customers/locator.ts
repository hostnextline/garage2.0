/* The positions still missing are found here, in the background, without asking anyone: customers and coming
   appointments whose address was typed without choosing a suggestion, or saved with no network (« la position sera
   trouvée plus tard »). Runs on the phones of the people who book (they may change a customer and an appointment),
   once the phone's copy of the data is ready, then every 10 minutes and when the network comes back; « Chercher »
   on a customer, an appointment or the map asks for it at once.
   One address at a time, gently with the free map service; only a sure answer is saved (locate.ts: the same door,
   street and town). An address that gave nothing is tried again after 6 hours, or as soon as it is changed. */
import { signal } from '@preact/signals';
import { allJobs, customersList } from '../../data/select';
import { saveCustomer, updateJob } from '../../data/api';
import { net } from '../../data/sync';
import { today } from '../../lib/dates';
import { locate } from '../places/locate';
import { may } from '../../domain/rights';
import { preview } from '../../data/auth';
import { COMING, jobPlace, missingPositions, placeTargets } from './positions';

export { addrKey, jobPlace, missingPositions, placeTargets, type Task } from './positions';

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
  // « Voir l'app comme… »: nothing may be written, so nothing is looked up (the addresses are not marked as tried)
  if (preview.value) return Promise.resolve({ found: 0, missing: 0, offline: false, placed: {} });
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
      if (r.status !== 'found') { markTried(t.key); continue; } // the map service does not know it: not again soon
      const pl = r.place.place;
      // what may still take it, read now: the address may have been corrected during the run
      const to = placeTargets(t, customersList.value, allJobs.value);
      try {
        if (to.customerId) {
          const c = customersList.value.find((x) => x.id === to.customerId);
          await saveCustomer({ id: to.customerId, lat: pl.lat, lng: pl.lng, ...(c?.city ? {} : { city: pl.city ?? null }) });
        }
        for (const id of to.jobIds) {
          await updateJob(id, { lat: pl.lat, lng: pl.lng });
          if (pl.lat != null && pl.lng != null) run.placed[id] = { lat: pl.lat, lng: pl.lng };
        }
        forget(t.key);
        run.found++;
        run.missing--;
      } catch (e) {
        // refused (rights, « Voir l'app comme… ») or kept for later: the address was found, so it is NOT marked as tried
        console.warn('locator: position found but not saved', t.key, e);
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
  const go = () => { if (net.value.ready && navigator.onLine !== false && may.book() && !preview.value) void locateMissing(); };
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
    try { await updateJob(j.id, { lat, lng }); } catch (e) { console.warn('locator: appointment keeps the customer position', j.id, e); }
  }
}
