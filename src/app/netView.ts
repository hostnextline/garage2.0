/* What the frame says about the connection, read from data/sync's `net` (tested in netView.test.ts). The data layer is
   being rebuilt at the same time: its newer fields (a lost session, storage kept only in memory, changes stuck) are
   read when they are there and ignored when they are not, so the frame works with the old engine and the new one.
   The new shape (data/net.ts): session 'ok' | 'expired' | 'lost' — 'expired' is a session being renewed (changes wait,
   nothing is refused), only 'lost' asks for a new sign-in; storage 'ok' | 'memory'; stuck = the change at the head of
   the queue that has not passed for a while ({ label, since, tries, why }) or null; a refused entry keeps the server's
   code and hint under `err`. */
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/errors';

export type ChipState = 'offline' | 'pending' | 'sending' | 'failed' | 'synced';
export type StuckWhy = 'network' | 'server' | 'update';
export interface NetView {
  chip: ChipState;
  online: boolean;
  pending: number;
  failed: number;
  /** the server no longer knows this session: changes wait for a new sign-in */
  sessionLost: boolean;
  /** this phone cannot keep changes (private window, storage broken, memory only) */
  storageLost: boolean;
  /** changes the server keeps refusing to take for now (not a refusal: they will be tried again) */
  stuck: number;
  /** what the stuck change is, in the person's words, when the data layer says it */
  stuckLabel: string | null;
  /** why it is stuck, when the data layer says it */
  stuckWhy: StuckWhy | null;
}

type Loose = Record<string, unknown>;
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : Array.isArray(x) ? x.length : 0);
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null);

/** stuck as the data layer gives it: a count, a list, or the one change at the head of the queue (an object) */
function readStuck(x: unknown): { n: number; label: string | null; why: StuckWhy | null } {
  if (x && typeof x === 'object' && !Array.isArray(x)) {
    const o = x as Loose;
    const why = o.why === 'network' || o.why === 'server' || o.why === 'update' ? o.why : null;
    return { n: 1, label: str(o.label), why };
  }
  return { n: num(x), label: null, why: null };
}

/** reads net (old or new shape); `browserOnline` = what the phone itself says (the 'offline' event comes at once) */
export function readNet(n: unknown, browserOnline = true): NetView {
  const o = (n && typeof n === 'object' ? n : {}) as Loose;
  const online = o.online !== false && browserOnline;
  const pending = num(o.pending);
  const failed = num(o.failed);
  const session = o.session ?? o.auth;
  // 'expired' = being renewed (every token refresh, a phone waking after an hour): never « Reconnecte-toi »
  const sessionLost = session === 'lost' || o.sessionLost === true;
  const storage = o.storage;
  const storageLost = o.storageBroken === true || storage === 'memory' || storage === 'broken' || storage === 'none';
  const st = readStuck(o.stuck);
  const chip: ChipState = !online ? 'offline' : pending > 0 ? (o.sending ? 'sending' : 'pending') : failed > 0 ? 'failed' : 'synced';
  return { chip, online, pending, failed, sessionLost, storageLost, stuck: st.n, stuckLabel: st.label, stuckWhy: st.why };
}

/** a refused change, in the person's language: the refusal's code when the entry keeps it (under `err` in the data
    layer's entries, at the top in older ones), else what was stored */
export function refusalText(e: { label?: string | null; error?: string | null; code?: unknown; hint?: unknown; err?: unknown }): string {
  const err = (e.err && typeof e.err === 'object' ? e.err : {}) as Loose;
  const code = typeof err.code === 'string' ? err.code : typeof e.code === 'string' ? e.code : undefined;
  const hint = typeof err.hint === 'string' ? err.hint : typeof e.hint === 'string' ? e.hint : undefined;
  const why = code || hint ? errorMessage({ code, hint, message: e.error || '' }) : String(e.error || '');
  return e.label ? t('shell.failed.line', { label: e.label, error: why }) : why;
}
