/* The rules of app versions, without the browser (tested in version.test.ts): what version.json says, whether a newer
   or an important version exists, whether this phone is too old to keep working, and when a waiting version may be
   put in place by the app itself. */
import { APP_VERSION, BUILT_AT } from '../../lib/config';

export interface RemoteVersion {
  version: string;
  built_at: string | null;
  important_since: string | null;
  notes: string | null;
  /** a version made before this date must update before anything else (set by hand for a harmful build) */
  min_built_at?: string | null;
}

export function parseRemote(j: unknown): RemoteVersion | null {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.version !== 'string' || !o.version) return null;
  const s = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  const v: RemoteVersion = { version: o.version, built_at: s(o.built_at), important_since: s(o.important_since), notes: s(o.notes) };
  const min = s(o.min_built_at);
  if (min) v.min_built_at = min;
  return v;
}
/** another version than this one is published (older too: a version taken back is the way back) */
export function isNewer(v: RemoteVersion | null, mine = APP_VERSION): boolean {
  return !!v && v.version !== mine && v.version !== 'dev';
}
const later = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && x > y;
};
/** an important version came out after this one was made */
export function isImportant(v: RemoteVersion | null, builtAt = BUILT_AT): boolean {
  return later(v?.important_since, builtAt);
}
/** this version is older than the oldest one the garage still accepts: it must update before anything else */
export function isTooOld(v: RemoteVersion | null, builtAt = BUILT_AT, mine = APP_VERSION): boolean {
  return mine !== 'dev' && isNewer(v, mine) && later(v?.min_built_at, builtAt);
}

/** a waiting version is put in place by the app only when nothing can be lost */
export interface ApplyMoment {
  /** a new version is downloaded and waits */
  ready: boolean;
  /** why the app is looking: it just opened, or it came back to the screen after `awayMs` */
  moment: 'start' | 'resume';
  awayMs: number;
  /** a sheet, a question or a menu is open */
  layersOpen: number;
  /** the person is typing in a field */
  typing: boolean;
  /** changes are being sent right now */
  sending: boolean;
  /** this version was already applied once in this visit (a version that does not take must not loop) */
  appliedBefore: boolean;
  /** the person already touched the screen since the app opened */
  touched: boolean;
  /** something was typed or chosen in a field since the last change of screen (a booking half filled and left over lunch:
      the focus is gone, the words are not saved). Optional: unknown = nothing typed */
  edited?: boolean;
  /** this phone keeps changes only in memory (private window, storage lost or full): a reload loses what waits */
  storageLost?: boolean;
  /** changes waiting on this phone */
  pending?: number;
}
/** back to the screen after this long away: a waiting version may be put in place */
export const RESUME_AFTER_MS = 30 * 60_000;
export function mayApplyNow(m: ApplyMoment): boolean {
  if (!m.ready || m.appliedBefore || m.layersOpen > 0 || m.typing || m.sending || m.edited) return false;
  // kept only in memory: a reload would throw away the changes still waiting
  if (m.storageLost && (m.pending ?? 0) > 0) return false;
  if (m.moment === 'start') return !m.touched;
  return m.awayMs >= RESUME_AFTER_MS;
}

/** « Vérifier les mises à jour » with a service worker: what to say once the check is over */
export function checkVerdict(o: { remote: RemoteVersion | null; waiting: boolean; failed: boolean }): 'ready' | 'none' | 'downloading' | 'error' {
  if (o.waiting) return 'ready';
  // version.json names another version but none is ready: it is still on its way (never « à jour »)
  if (isNewer(o.remote)) return 'downloading';
  if (o.failed && !o.remote) return 'error';
  return 'none';
}
