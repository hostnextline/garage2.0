/* « Vraies routes » (CONTRACT §4): the trips still missing over the coming days (a new appointment's address, an address
   changed, a warm that failed, the rush-hour times) are measured in the background, without asking anyone, so an
   appointment does not keep the « unknown » time until the nightly job. Copied on the background locator
   (shared/customers/locator.ts): once the phone's copy of the data is ready (a few seconds after the app opens), then
   every 10 minutes, and when the signal comes back after a turn missed offline.
   Each turn, in this order, stops at the first « no » (`whyNot`, pure, tested):
   - the switch « Vraies routes » is on (the phone's copy of the settings);
   - this person is the owner or the office (the server's own rule for `sweep`: supabase/functions/drive/handler.ts);
   - not « Voir l'app comme… »; the first download is done; the phone has signal (the browser AND the server link);
   - no measure of everything already under way on this device (this service's last turn, or « Mesurer maintenant » of
     the settings panel: roadsSweeping) — never two at once;
   - something is left that can be measured now: `roadsStatus()` first (read only: it spends no TomTom transaction and is
     not counted in the function's brakes), and the sweep only when the server says its switch is on and `leftNow` > 0:
     the usual-hours trips, plus the rush-hour ones only while TomTom can be asked (the server has its key, the month's
     ceiling is not 0 nor reached: OSRM never measures the rush hours, so without TomTom `left` never reaches 0).
   Then `measureRoads()` (drive { action: 'sweep' }: ~40 s at most on the server), called again while it says `more` —
   NEVER because `left` is above 0 (the lead's decision of 2026-11-20 19:20, build-fn « for the lead ») — at most
   SWEEP_RULES.maxCalls a turn (a few of the person's 60 calls an hour), and not after a call that measured and planned
   nothing, a refusal, or a « no » of the rules above (the switch off, no signal, « Mesurer maintenant » started).
   A turn that fails (no signal, a refusal) changes nothing: the next one tries again. */
import { signal } from '@preact/signals';
import { me, preview } from '../data/auth';
import { roadsOn } from '../data/select';
import { net } from '../data/net';
import { measureRoads, roadsStatus, roadsSweeping, type DriveAnswer, type RoadsStatusDone } from '../data/roads';

export const SWEEP_RULES = {
  /** a turn every this often while the app is open */
  everyMs: 10 * 60_000,
  /** after the first download, so the screens' own requests go first */
  firstMs: 4_000,
  /** how often the start looks whether the first download is done */
  readyPollMs: 1_000,
  /** after the signal came back (a turn missed offline) */
  onlineMs: 3_000,
  /** the most sweep calls of one turn while the server says `more` (each ~40 s at most; 10-minute turns) */
  maxCalls: 5
};

/** what a sweep can measure now, from the status: the usual-hours trips always (OSRM measures them without TomTom); the
    rush-hour ones (and the OSRM times to ask TomTom again: `left` − `left0`) only while TomTom can be asked — the server
    has its key, and this month's ceiling is neither 0 nor reached (the same rule as the settings panel's rushBlockedNow,
    plus the month reached: the sweep would only find them still waiting) */
export function leftNow(s: Pick<RoadsStatusDone, 'key' | 'left' | 'left0' | 'month'>): number {
  const m = s.month;
  const tomtom = s.key && !(m && (m.cap <= 0 || m.tx >= m.cap));
  return Math.max(0, tomtom ? s.left : s.left0);
}

/** why a turn does nothing now (null: it goes on to ask what is left) */
export type SweepSkip = 'off' | 'role' | 'preview' | 'not_ready' | 'offline' | 'busy';
export interface SweepFacts {
  on: boolean; owner: boolean; office: boolean; preview: boolean; ready: boolean; online: boolean; browserOnline: boolean;
  /** a measure of everything already under way on this device */
  sweeping: boolean;
}
export function whyNot(f: SweepFacts): SweepSkip | null {
  if (!f.on) return 'off';
  if (!f.owner && !f.office) return 'role';
  if (f.preview) return 'preview';
  if (!f.ready) return 'not_ready';
  if (!f.online || !f.browserOnline) return 'offline';
  if (f.sweeping) return 'busy';
  return null;
}
function factsNow(): SweepFacts {
  const who = me.value;
  return {
    on: roadsOn.value, owner: !!who?.owner, office: !!who?.roles?.includes('office'), preview: preview.value,
    ready: net.value.ready, online: net.value.online !== false,
    browserOnline: typeof navigator === 'undefined' || navigator.onLine !== false,
    sweeping: running || roadsSweeping.value > 0
  };
}

/** what a turn did: skipped (why), nothing left, measured (the answer), or failed (no signal, no answer) */
export type SweepTurn =
  | { at: number; did: 'skipped'; why: SweepSkip }
  | { at: number; did: 'nothing_left' }
  | { at: number; did: 'measured'; answer: DriveAnswer }
  | { at: number; did: 'failed'; code: string };
/** the last turn of this device (tests, and the page's data-roads-sweep for the end-to-end test) */
export const roadsSweep = signal<{ busy: boolean; turns: number; last: SweepTurn | null }>({ busy: false, turns: 0, last: null });

let running = false;
/** a turn was skipped for no signal: the next « online » does it (not every « online » of a flaky signal) */
let missed = false;
function tell(state: 'busy' | 'idle') {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.roadsSweep = state;
  document.documentElement.dataset.roadsSweepTurns = String(roadsSweep.value.turns);
}
function done(t: SweepTurn): SweepTurn {
  roadsSweep.value = { busy: false, turns: roadsSweep.value.turns + 1, last: t };
  tell('idle');
  return t;
}
const codeOf = (e: unknown): string => {
  const x = e as { code?: unknown; hint?: unknown } | null;
  return typeof x?.code === 'string' && x.code ? x.code : typeof x?.hint === 'string' && x.hint ? x.hint : 'network';
};

/** one turn now (the timers call it; a test may too). Never throws, never two at once. */
export async function sweepTurn(): Promise<SweepTurn> {
  const why = whyNot(factsNow());
  if (why) {
    if (why === 'offline') missed = true;
    // a turn under way is not counted twice
    if (why === 'busy') return { at: Date.now(), did: 'skipped', why };
    return done({ at: Date.now(), did: 'skipped', why });
  }
  missed = false;
  running = true;
  roadsSweep.value = { ...roadsSweep.value, busy: true };
  tell('busy');
  try {
    const s = await roadsStatus();
    if (!s.ok) return done({ at: Date.now(), did: 'failed', code: s.code });
    if (!s.on || !(leftNow(s) > 0)) return done({ at: Date.now(), did: 'nothing_left' });
    let a: DriveAnswer | null = null;
    for (let calls = 0; calls < SWEEP_RULES.maxCalls; calls++) {
      // the switch, the person, the signal or the panel may have changed while the status (or the last call) was asked
      const again = whyNot({ ...factsNow(), sweeping: roadsSweeping.value > 0 });
      if (again) return a ? done({ at: Date.now(), did: 'measured', answer: a }) : done({ at: Date.now(), did: 'skipped', why: again });
      a = await measureRoads();
      // on `more` only (never on `left`): a refusal, nothing more to do in a call, or a call that did nothing ends the turn
      if (!a.ok || !a.more || (a.stored === 0 && a.planned === 0)) break;
    }
    return done({ at: Date.now(), did: 'measured', answer: a! });
  } catch (e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) missed = true;
    return done({ at: Date.now(), did: 'failed', code: codeOf(e) });
  } finally {
    running = false;
  }
}

/* ---------- the timers (once for the whole app: the frame starts it with its other background services) ---------- */
let started = false;
let firstPoll: ReturnType<typeof setInterval> | null = null;
let firstTurn: ReturnType<typeof setTimeout> | null = null;
let every: ReturnType<typeof setInterval> | null = null;
let onlineTurn: ReturnType<typeof setTimeout> | null = null;
let onOnline: (() => void) | null = null;
const go = () => { void sweepTurn(); };

export function startRoadsSweep(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  firstPoll = setInterval(() => {
    if (!net.value.ready) return;
    if (firstPoll) clearInterval(firstPoll);
    firstPoll = null;
    firstTurn = setTimeout(go, SWEEP_RULES.firstMs);
  }, SWEEP_RULES.readyPollMs);
  every = setInterval(go, SWEEP_RULES.everyMs);
  onOnline = () => {
    if (!missed) return;
    if (onlineTurn) clearTimeout(onlineTurn);
    onlineTurn = setTimeout(go, SWEEP_RULES.onlineMs);
  };
  window.addEventListener('online', onOnline);
}
/** stops everything (tests) */
export function stopRoadsSweep(): void {
  if (firstPoll) clearInterval(firstPoll);
  if (firstTurn) clearTimeout(firstTurn);
  if (every) clearInterval(every);
  if (onlineTurn) clearTimeout(onlineTurn);
  if (onOnline && typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  firstPoll = firstTurn = every = onlineTurn = null;
  onOnline = null;
  started = false;
  running = false;
  missed = false;
  roadsSweep.value = { busy: false, turns: 0, last: null };
}
