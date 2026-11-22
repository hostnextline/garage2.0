/* « exact move » (Hassan, 2026-11-21: « when i move an appointment, i want it to move exactly where i point it to move, but
   the rest stays the same »; STATE.md A2, A4, A5): the ONE flow of every place that moves an appointment to a time it
   showed (the agenda's hour grids, « Déplacer », the agenda's window list, « Changer de camion »).
   1. No signal: said, nothing kept on the phone (a pointed time is never queued: A4).
   1b. « Vraies routes » on: the address's trips for that day measured first, waited as for the suggestions (A7: so no
      measure lands seconds after the move and plans the day again).
   2. The server's preview of that very move (move_preview with the minute; nothing written). Its own truck does not work
      that day (pick_truck) and the place pointed came with the vehicle the server offered there (a time of the calendar,
      a row of windows): that vehicle, asked again, and the question always says it (never a truck changed in silence).
   3. ONE question, by what it says: nobody late → the confirm with true words (a sheet's tap is already the choice: no
      question there unless a stop would arrive later); somebody late → who and by how much, « Déplacer quand même » /
      « Choisir une autre heure »; the truck cannot be there → the earliest, « Mettre à … » (asked again at that minute) /
      « Choisir une autre heure »; not measured or no answer → said plainly, « Déplacer quand même » / « Annuler ».
   4. « Garde-route » as before (the caller's question, after this one).
   5. The move, with the stops accepted late; « the day changed since » (late_changed) → the preview again, once.
   The caller says the result (doneWords: the late customers NAMED, so they can be called; the app texts them nothing) and
   sends the moved customer's text by today's rule (the server's `tell`). */
import { net, refetch, pull } from '../../data/sync';
import { moveJob } from '../../data/api';
import { exactPreview, exactAnswer, exactRefusal, ARRIVE_LATE, LATE_CHANGED, PICK_TRUCK, type ExactStop } from '../../data/exact';
import { warmJobDay } from '../../data/roads';
import { windowOf, job as jobRow, truckLabel } from '../../data/select';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { clock, duration, type Day } from '../../lib/dates';
import { codeWords, isNetworkError, classify, Refused } from '../../lib/errors';
import { ask, toast } from '../../ui';
import { exactCase, lateOkOf, type ExactCase } from '../../domain/jobs/exact';
import { jobPerson } from '../../domain/jobs/words';
import { dayInSentence } from '../../domain/jobs/when';
import { dropTells } from '../../domain/moment/moveRules';
import { wantsText } from '../moment/notify';

type Question = { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean };
export interface ExactAsk {
  job: Job; day: Day;
  /** the truck picked (the grid's column, « Changer de camion »); null: the appointment's own (S2) */
  truck: string | null;
  /** the minute pointed */
  at: number;
  /** a drop on the grid asks its confirm; a sheet's tap is already the choice (false) */
  confirm: boolean;
  /** the confirm adds « Un texto avertira … du changement. » */
  sms?: boolean;
  /** « Garde-route »: the caller's question (null: nothing to ask), asked once, after this flow's question */
  far?: () => Promise<Question | null>;
  /** the minute changed (« Mettre à … »): the grid moves its held block there */
  onAt?: (m: number) => void;
  /** the vehicle the server offered at that place (a unit of the « Déplacer » calendar, a row of windows): taken only
      when the appointment's own truck does not work that day (pick_truck), and said in the question */
  offered?: string | null;
  /** the preview's wait before « Je n'ai pas pu vérifier… » (PREVIEW_WAIT_MS; tests shorten it) */
  previewMs?: number;
}
export type ExactDone =
  | { kind: 'moved'; at: number; r: { queued: false; data?: unknown }; late: string[]; real: number | null }
  | { kind: 'stopped' }
  /** refused, by the preview or by the move: the error, whose words errorMessage says */
  | { kind: 'refused'; error: unknown };

/** a customer's first name for the questions (a stop the phone does not hold: « un client ») */
function nameOf(id: string): string {
  const row = jobRow(id);
  return (row && jobPerson(row)) || t('jobs.exact.someone');
}
const names = (ids: readonly string[]) => ids.map(nameOf).join(', ');

/** how long the preview is waited for before the person is told it could not be checked (review F3: a weak signal or a
    busy server is NO ANSWER, said plainly with « Déplacer quand même » / « Annuler », never « Pas de réseau » after 15 s) */
export const PREVIEW_WAIT_MS = 6000;
/** no signal at all (the browser's « no network »), not a slow or failing answer */
const noSignal = (e: unknown) => isNetworkError(e) && classify(e).sub === 'offline';
/** the preview, read as one case; no signal: 'offline'; no answer in time, a timeout, a server error: 'unsure'
    ('unchecked'); a refusal keeps the error thrown (its words) */
async function previewCase(j: Job, day: Day, truck: string | null, at: number, waitMs: number): Promise<(ExactCase & { error?: unknown }) | { kind: 'offline' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), waitMs); });
  try {
    const a = await Promise.race([exactPreview(j.id, day, truck, at), late]);
    if (a === 'late') return { kind: 'unsure', why: 'unchecked' };
    return exactCase(a, j.id);
  } catch (e) {
    if (noSignal(e)) return { kind: 'offline' };
    if (isNetworkError(e)) return { kind: 'unsure', why: 'unchecked' };
    const r = exactRefusal(e);
    if (r?.code === ARRIVE_LATE) return { kind: 'early', earliest: r.earliest, keep: r.earliestKeep };
    if (r) return { kind: 'refused', code: r.code, error: e };
    // an older server (no such preview), an error: said plainly, the person decides
    return { kind: 'unsure', why: 'unchecked' };
  } finally { clearTimeout(timer); }
}

function lines(...xs: (string | false | null | undefined)[]): string { return xs.filter(Boolean).join('\n'); }
const pushedLines = (ps: readonly ExactStop[], l: 'fr' | 'en') => ps.length
  ? [t('jobs.exact.pushed', { n: ps.length }), ...ps.map((s) => t('jobs.exact.pushedLine', { name: nameOf(s.id), eta: clock(s.etaAfter ?? 0, l), was: clock(s.etaBefore ?? 0, l) }))].join('\n') : '';

/** the question for one case; null: nothing to ask (a sheet's tap, nobody's time changes) */
export function questionOf(c: ExactCase, a: { job: Job; day: Day; at: number; confirm: boolean; sms?: boolean; truck?: string | null }): Question | null {
  const l = lang.value;
  const who = jobPerson(a.job) || t('agenda.move.someone');
  const win = windowOf(a.at);
  const time = clock(a.at, l);
  const title = t('jobs.exact.question', { name: who, when: dayInSentence(a.day, l), time });
  const told = (same: boolean) => t(same ? 'jobs.exact.text' : 'jobs.exact.told', { from: clock(win[0], l), to: clock(win[1], l) });
  // beside other customers' lines (late, unsure): whose window it is, said (review L2: it read as the late customer's)
  const toldFor = () => t('jobs.exact.toldFor', { name: who, from: clock(win[0], l), to: clock(win[1], l) });
  const sms = a.sms ? t('agenda.move.textSms', { name: who }) : '';
  // its own truck does not work that day: the vehicle the server offered there, said (never changed in silence)
  const other = a.truck ? t('jobs.exact.otherTruck', { truck: truckLabel(a.truck) }) : '';
  if (c.kind === 'ok') {
    if (!a.confirm && !c.pushed.length && !other) return null;
    return { title, text: lines(other, told(!c.pushed.length), pushedLines(c.pushed, l), sms), ok: t('agenda.move.ok') };
  }
  if (c.kind === 'late') {
    const n = c.late.length;
    return {
      // the moved appointment and its time named too (review L2)
      title: n ? t('jobs.exact.lateTitle', { n, name: nameOf(c.late[0].id), who, time }) : title,
      text: lines(
        ...c.late.map((s) => t('jobs.exact.lateLine', { name: nameOf(s.id), eta: clock(s.etaAfter ?? 0, l), by: duration(s.lateMin, l), from: clock(s.winStart ?? 0, l), to: clock(s.winEnd ?? 0, l) })),
        c.overHours > 0 && t('jobs.exact.overHours', { by: duration(c.overHours, l) }),
        pushedLines(c.pushed, l), other, toldFor(), sms),
      ok: t('jobs.exact.lateOk'), cancel: t('jobs.exact.other'), danger: true
    };
  }
  if (c.kind === 'unsure') {
    return { title, text: lines(t(c.why === 'unmeasured' ? 'jobs.exact.unmeasured' : 'jobs.exact.unchecked'), other, told(false), sms), ok: t('jobs.exact.lateOk'), cancel: t('common.cancel') };
  }
  return null;
}

/** the earliest question: null when the server did not say the earliest minute. « Mettre à … » IS the yes to that minute
    (no confirm after it), so when that minute gives the customer another window than the one pointed, the window and the
    text that goes are said HERE (review F5: from a sheet nothing else would ever show them) */
function earlyQuestion(a: { job: Job; day: Day; at: number }, c: { earliest: number | null; keep: number | null }): Question | null {
  if (c.earliest == null) return null;
  const l = lang.value;
  const time = clock(a.at, l), earliest = clock(c.earliest, l);
  const name = jobPerson(a.job) || t('jobs.exact.someone');
  const win = windowOf(c.earliest);
  const told = win[0] !== windowOf(a.at)[0]
    ? [t('jobs.exact.earlyTold', { earliest, from: clock(win[0], l), to: clock(win[1], l) }),
      wantsText('moved', a.job.id) && dropTells(a.job, a.day, win[0]) ? t('agenda.move.textSms', { name }) : ''].filter(Boolean).join(' ')
    : '';
  return {
    title: t('jobs.exact.earlyTitle', { time }),
    text: lines(t('jobs.exact.early', { name, time, earliest }), told,
      c.keep != null && c.keep !== c.earliest && t('jobs.exact.earlyKeep', { time: clock(c.keep, l) })),
    ok: t('jobs.exact.earlyOk', { earliest }), cancel: t('jobs.exact.other')
  };
}

const offline = () => { toast(t('jobs.exact.offline'), { kind: 'bad' }); return { kind: 'stopped' } as const; };
/** the wait before the day's changes are pulled once more after a lost answer (the server may still be finishing) */
const LOST_PULL_MS = 5000;
function lost(jobId: string) {
  toast(t('jobs.exact.lost'), { kind: 'bad', ms: 8000 });
  void refetch('jobs', jobId).catch(() => undefined);
  setTimeout(() => { void pull('jobs').catch(() => undefined); }, LOST_PULL_MS);
  return { kind: 'stopped' } as const;
}

/** asks, then moves the appointment to that very minute; never throws (a refusal is given back for the caller to say) */
export async function moveAt(a: ExactAsk): Promise<ExactDone> {
  if (!net.value.online) return offline();
  // A7: « Vraies routes » on, the trips of that address for that day are measured first (at once when off)
  await warmJobDay(a.job.id, a.day);
  let at = a.at;
  let truck = a.truck;
  // the vehicle the server offered, taken because its own truck does not work that day (said in the question)
  let offered: string | null = null;
  // « Mettre à … » already said yes to that minute: no second confirm for it
  let chosen = false;
  let again = false;
  let farAsked = false;
  // a few rounds at most (« Mettre à … », the day changed meanwhile): never a loop of questions
  for (let round = 0; ; round++) {
    if (round >= 4) { toast(t('errors.late_changed'), { kind: 'bad' }); return { kind: 'stopped' }; }
    const c = await previewCase(a.job, a.day, truck, at, a.previewMs ?? PREVIEW_WAIT_MS);
    if (c.kind === 'offline') return offline();
    if (c.kind === 'refused' && c.code === PICK_TRUCK && truck == null && a.offered && !offered) {
      truck = offered = a.offered;
      continue;
    }
    // refused for another reason (its truck does not work that day, a moment started…): given back with its words, for
    // the caller to say (the grid then opens the windows still possible that day)
    if (c.kind === 'refused') return { kind: 'refused', error: c.error ?? new Refused(c.code, codeWords(c.code, 'move_job') ?? t('jobs.exact.unchecked')) };
    if (c.kind === 'early') {
      const q = earlyQuestion({ job: a.job, day: a.day, at }, c);
      if (!q) { toast(t('errors.arrive_late'), { kind: 'bad' }); return { kind: 'stopped' }; }
      if (!(await ask(q))) return { kind: 'stopped' };
      at = c.earliest!;
      chosen = true;
      a.onAt?.(at);
      continue;
    }
    // the person already said yes to this minute (« Mettre à … »), or to this move before the day changed: asked again
    // only when there is something new to hear
    const q = questionOf(c, { job: a.job, day: a.day, at, confirm: a.confirm && !chosen && !again, sms: a.sms, truck: offered });
    if (q && !(await ask(q))) return { kind: 'stopped' };
    if (a.far && !farAsked) {
      farAsked = true;
      const f = await a.far();
      if (f && !(await ask(f))) return { kind: 'stopped' };
    }
    try {
      const r = await moveJob(a.job.id, a.day, 'day', truck, { start: windowOf(at)[0], flex: false, at, lateOk: lateOkOf(c, a.job.id) });
      return { kind: 'moved', at, r: { queued: false, data: r.data }, ...landed(r.data, a.job.id, at) };
    } catch (e) {
      if (noSignal(e)) return offline();
      // sent, but its answer was lost (a timeout, a server error on the way back): it may well be done on the server.
      // Said so, and the appointment asked again (now, then the day's changes a little later): never « réessaie » on
      // a move that may have happened (review F3)
      if (isNetworkError(e) && classify(e).sub !== 'busy') return lost(a.job.id);
      const code = exactRefusal(e)?.code;
      // the day changed since the preview (a booking, another move): look again once, and ask again with the new facts
      if (!again && (code === LATE_CHANGED || code === ARRIVE_LATE)) { again = true; continue; }
      return { kind: 'refused', error: e };
    }
  }
}

/** what the answer says once moved: the customers now late (named), and where it really landed when not at that minute
    (an older server, the blocks mode: never a silent jump) */
function landed(data: unknown, jobId: string, at: number): { late: string[]; real: number | null } {
  const ans = exactAnswer(data);
  const late = (ans?.stops ?? []).filter((s) => s.id !== jobId && s.late).map((s) => s.id);
  const row = ((data as { rows?: { jobs?: Job[] } } | null)?.rows?.jobs ?? []).find((x) => x.id === jobId);
  const real = ans?.stops.find((s) => s.id === jobId)?.etaAfter ?? row?.eta_min ?? null;
  return { late, real: real != null && real !== at ? real : null };
}

/** the message once moved: « Rendez-vous déplacé : demain à 13 h. », the late customers named (to call them), or where it
    really landed. `head`: the caller's own first sentence (« Changer de camion »: « Rendez-vous passé à … ») */
export function doneWords(d: Extract<ExactDone, { kind: 'moved' }>, day: Day, head?: string): string {
  const l = lang.value;
  const first = d.real != null
    ? t('jobs.exact.notAt', { real: clock(d.real, l), time: clock(d.at, l) })
    : head ?? t('jobs.exact.done', { when: dayInSentence(day, l), time: clock(d.at, l) });
  return d.late.length ? `${first} ${t('jobs.exact.doneLate', { n: d.late.length, names: names(d.late) })}` : first;
}
