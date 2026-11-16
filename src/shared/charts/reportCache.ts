/* The last answer of each server report (dashboard, treasury_report), kept on this device so the numbers still show
   with no signal. Entries are « his.report.<person>.<what>.<period> » = { at, data } in localStorage (the key and its
   content are unchanged since the first version), with a copy in memory.
   - An entry is shaped again when read (`normalize`): an answer kept by an older version of the app can never break
     the screen; one that cannot be read is dropped.
   - Only the most recent entries are kept (one per month or period opened would grow for ever).
   - clearReports() forgets them all (to call at sign-out: the garage's numbers must not stay on a shared phone). */

export interface Cached<T = unknown> { at: string; data: T }
export const REPORT_PREFIX = 'his.report.';
/** how many reports stay on the device (the most recent ones) */
export const KEEP_REPORTS = 24;
const mem = new Map<string, Cached>();

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
function drop(k: string) {
  mem.delete(k);
  try { storage()?.removeItem(k); } catch (e) { console.warn('report cache', e); }
}

/** the kept answer for `k`, shaped by `normalize` (null when there is none, or it cannot be read) */
export function readReport<T>(k: string, normalize?: (raw: unknown) => T): Cached<T> | null {
  let c = mem.get(k);
  if (!c) {
    let s: string | null = null;
    try { s = storage()?.getItem(k) ?? null; } catch (e) { console.warn('report cache', e); }
    if (!s) return null;
    try {
      const v = JSON.parse(s) as Cached;
      if (!v || typeof v.at !== 'string') { drop(k); return null; }
      c = v;
    } catch { drop(k); return null; }
  }
  try {
    const out = { at: c.at, data: normalize ? normalize(c.data) : c.data } as Cached<T>;
    mem.set(k, out);
    return out;
  } catch { drop(k); return null; }
}

/** keeps an answer (in memory always; on the device when there is room), then trims the oldest entries */
export function writeReport(k: string, v: Cached) {
  mem.set(k, v);
  const st = storage();
  if (!st) return;
  try { st.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('report cache: memory only', e); }
  pruneReports(st);
}

/** the kept reports beyond the most recent KEEP_REPORTS leave the device */
export function pruneReports(st: Storage | null = storage(), keep = KEEP_REPORTS) {
  if (!st) return;
  const all: { k: string; at: string }[] = [];
  for (let n = 0; n < st.length; n++) {
    const k = st.key(n);
    if (!k || !k.startsWith(REPORT_PREFIX)) continue;
    let at = '';
    try { at = String((JSON.parse(st.getItem(k) || '{}') as Partial<Cached>).at || ''); } catch { at = ''; }
    all.push({ k, at });
  }
  all.sort((a, b) => b.at.localeCompare(a.at));
  for (const x of all.slice(keep)) drop(x.k);
}

/** forgets every kept report, on the device and in memory (sign-out) */
export function clearReports() {
  const st = storage();
  const keys: string[] = [];
  if (st) for (let n = 0; n < st.length; n++) { const k = st.key(n); if (k?.startsWith(REPORT_PREFIX)) keys.push(k); }
  for (const k of keys) drop(k);
  mem.clear();
}
