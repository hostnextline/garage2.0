/* What the frame says about the connection, read from data/sync's `net` (tested in netView.test.ts). The data layer is
   being rebuilt at the same time: its newer fields (a lost session, storage kept only in memory, changes stuck) are
   read when they are there and ignored when they are not, so the frame works with the old engine and the new one. */
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/errors';

export type ChipState = 'offline' | 'pending' | 'sending' | 'failed' | 'synced';
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
}

type Loose = Record<string, unknown>;
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : Array.isArray(x) ? x.length : 0);

/** reads net (old or new shape); `browserOnline` = what the phone itself says (the 'offline' event comes at once) */
export function readNet(n: unknown, browserOnline = true): NetView {
  const o = (n && typeof n === 'object' ? n : {}) as Loose;
  const online = o.online !== false && browserOnline;
  const pending = num(o.pending);
  const failed = num(o.failed);
  const session = o.session ?? o.auth;
  const sessionLost = session === 'lost' || session === 'expired' || o.sessionLost === true;
  const storage = o.storage;
  const storageLost = o.storageBroken === true || storage === 'memory' || storage === 'broken' || storage === 'none';
  const stuck = num(o.stuck);
  const chip: ChipState = !online ? 'offline' : pending > 0 ? (o.sending ? 'sending' : 'pending') : failed > 0 ? 'failed' : 'synced';
  return { chip, online, pending, failed, sessionLost, storageLost, stuck };
}

/** a refused change, in the person's language: the refusal's code when the entry keeps it, else what was stored */
export function refusalText(e: { label?: string | null; error?: string | null; code?: unknown; hint?: unknown }): string {
  const code = typeof e.code === 'string' ? e.code : undefined;
  const hint = typeof e.hint === 'string' ? e.hint : undefined;
  const why = code || hint ? errorMessage({ code, hint, message: e.error || '' }) : String(e.error || '');
  return e.label ? t('shell.failed.line', { label: e.label, error: why }) : why;
}
