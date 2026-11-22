/* When IndexedDB refuses to keep a change (private window, the iPhone lost its connection to the database, the disk
   is full), the change still goes in the engine's memory queue and is sent while the app stays open. A copy also goes
   here, in the browser's small storage (localStorage `his.rescue.<uid>`), so it survives a reload when that storage
   works: the next start puts it back at the end of the outbox. Big pictures do not fit (the limits keep the rest of
   the small storage usable); they stay in memory only, and the frame says so. What is kept is always the head of the
   queue, without a hole: once one entry does not fit, the later ones are not kept either (a « signed » step must never
   come back after a reload without the signature picture it points to: rescue-order gap). */
import type { OutboxEntry } from './local';

const KEY = (uid: string) => `his.rescue.${uid}`;
const ENTRY_MAX = 100_000;
const TOTAL_MAX = 1_000_000;

/** writes the memory-only entries; returns the op ids of those really kept there */
export function saveRescue(uid: string, entries: OutboxEntry[]): Set<string> {
  const kept: OutboxEntry[] = [];
  try {
    if (!entries.length) { localStorage.removeItem(KEY(uid)); return new Set(); }
    let size = 2;
    for (const e of entries) {
      const s = JSON.stringify(e).length;
      if (s > ENTRY_MAX || size + s > TOTAL_MAX) break;
      kept.push(e); size += s + 1;
    }
    localStorage.setItem(KEY(uid), JSON.stringify(kept));
    return new Set(kept.map((e) => e.op));
  } catch { return new Set(); }
}
export function readRescue(uid: string): OutboxEntry[] {
  try {
    const s = localStorage.getItem(KEY(uid));
    const v = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? (v as OutboxEntry[]).filter((e) => e && typeof e.op === 'string' && typeof e.kind === 'string') : [];
  } catch { return []; }
}
export function clearRescue(uid: string) { try { localStorage.removeItem(KEY(uid)); } catch { /* nothing kept there */ } }
