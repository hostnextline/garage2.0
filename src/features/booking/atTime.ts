/* « Réserver à l'heure choisie » (Part 30; Hassan, 2026-11-22: « hours can change, but i want to be able to decide so if i
   forcefully book someone at a specific time, i want the system to show a warning if there is no place but still let me
   book it, then show me the new map »; STATE.md K1, K2, and the lead's correction: « hours can change »). The ONE flow of
   « Réserver » when the owner or the office took a time the server does NOT offer (« complet » in the calendar:
   choice.full; a time it offers books as before, its window and no minute pinned: useSubmit). The appointment goes AT
   that minute, pinned, as the exact move does (src/shared/jobs/exactMove.ts, the words and the protocol Hassan knows):
   1. No signal, or a server without the preview: given back (`fallback`): « Réserver » books as before (the day, the
      app gives the window).
   2. The server's preview of that very booking (book_preview; nothing written). Then ONE question, by what it says:
      - room at that very minute (nobody late, someone maybe pushed inside their window): no question;
      - no room (someone late, the truck past its hours): the warning — who and by how much, the truck's end —,
        « Choisir une autre heure » / « Réserver quand même à 14 h » (owner, office); anyone else sees why not;
      - the truck cannot be there at that minute: « Pas possible à 8 h … au plus tôt 8 h 06 », « Mettre à 8 h 06 »
        (asked again at that minute);
      - not measured, or no answer in time: said plainly, « Réserver quand même » / « Annuler ».
   3. The booking, with the ones accepted late; « the day changed since » (late_changed, arrive_late) → the preview again,
      once. The caller says the result, sends the booking text at once (as today) and shows the new map. */
import { t, lang } from '../../lib/i18n';
import { clock, duration, type Day } from '../../lib/dates';
import { codeWords, isNetworkError, classify, Refused } from '../../lib/errors';
import { exactRefusal, ARRIVE_LATE, LATE_CHANGED, type ExactStop } from '../../data/exact';
import { bookAtAnswer, bookAtJob, type BookAtAnswer } from '../../data/bookAt';
import type { BookInput, ItemInput } from '../../data/api';
import { exactCase, lateOkOf, type ExactCase } from '../../domain/jobs/exact';
import { dayInSentence } from '../../domain/jobs/when';

export type Question = { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean };
export interface AtTimeDeps {
  preview: (job: BookInput, lines: ItemInput[]) => Promise<BookAtAnswer | null>;
  book: (job: BookInput, lines: ItemInput[]) => Promise<{ id: string; data?: unknown }>;
  ask: (q: Question) => Promise<boolean>;
  online: () => boolean;
  /** a customer's first name (a stop the phone does not hold: « un client ») */
  nameOf: (jobId: string) => string;
  /** the window told to a customer for an arrival (the garage's rule: win_for) */
  windowOf: (m: number) => readonly [number, number];
  /** a late customer's new window, which leaves with « Envoyer les heures aux clients » (exactMove's lateWindow) */
  lateWindow?: (s: ExactStop, day: Day) => readonly [number, number] | null;
}
export interface AtTimeAsk {
  job: BookInput; lines: ItemInput[];
  /** the minute pointed */
  at: number;
  /** the vehicle asked (a truck chosen, a mechanic's own); null: the server chooses */
  truck: string | null;
  /** the new customer's first name, for the questions */
  name: string;
  /** the person may force (owner, office): the server's may_force wins when it says it */
  mayForce: boolean;
  previewMs?: number;
}
export type AtTimeDone =
  | { kind: 'booked'; at: number; id: string; data: unknown; answer: BookAtAnswer | null; late: string[]; pushed: string[]; forced: boolean }
  /** the person chose another time (or said no) */
  | { kind: 'stopped'; why?: 'offline' | 'lost' | 'rounds' | 'mechanic' }
  | { kind: 'refused'; error: unknown }
  /** no signal, an older server: « Réserver » books as before */
  | { kind: 'fallback' };

/** how long the preview is waited for before « Je n'ai pas pu vérifier… » (the exact move's PREVIEW_WAIT_MS) */
export const PREVIEW_WAIT_MS = 6000;
const noSignal = (e: unknown) => isNetworkError(e) && classify(e).sub === 'offline';
type Case = ExactCase & { answer?: BookAtAnswer | null; error?: unknown };

/** the preview read as one case; no signal or no preview at all: 'fallback' */
async function previewCase(a: AtTimeAsk, d: AtTimeDeps, at: number): Promise<Case | { kind: 'fallback' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((r) => { timer = setTimeout(() => r('late'), a.previewMs ?? PREVIEW_WAIT_MS); });
  try {
    const r = await Promise.race([d.preview(bookAtJob(a.job, at, a.truck), a.lines), late]);
    if (r === 'late') return { kind: 'unsure', why: 'unchecked' };
    if (!r) return { kind: 'fallback' };
    return { ...exactCase(r, a.job.id!), answer: r };
  } catch (e) {
    if (noSignal(e)) return { kind: 'fallback' };
    if (isNetworkError(e)) return { kind: 'unsure', why: 'unchecked' };
    const r = exactRefusal(e);
    if (r?.code === ARRIVE_LATE) return { kind: 'early', earliest: r.earliest, keep: r.earliestKeep };
    if (r) return { kind: 'refused', code: r.code, error: e };
    return { kind: 'unsure', why: 'unchecked' };
  } finally { clearTimeout(timer); }
}

function lines(...xs: (string | false | null | undefined)[]): string { return xs.filter(Boolean).join('\n'); }

/** the question for one case (null: nothing to ask: room at that minute, someone pushed inside their window is not
    asked, as a booking with room never was); `may`: the person may force it */
export function atQuestion(c: Case, a: { name: string; day: Day; at: number; may: boolean }, d: Pick<AtTimeDeps, 'nameOf' | 'windowOf' | 'lateWindow'>): Question | null {
  const l = lang.value;
  const time = clock(a.at, l);
  const who = a.name || t('booking.atTime.someone');
  const win = d.windowOf(a.at);
  const told = t('booking.atTime.told', { name: who, from: clock(win[0], l), to: clock(win[1], l) });
  const pushed = (ps: readonly ExactStop[]) => ps.length
    ? [t('booking.atTime.pushed', { n: ps.length }), ...ps.map((s) => t('booking.atTime.pushedLine', { name: d.nameOf(s.id), eta: clock(s.etaAfter ?? 0, l), was: clock(s.etaBefore ?? 0, l) }))].join('\n') : '';
  if (c.kind === 'ok') return null;
  if (c.kind === 'late') {
    const n = c.late.length;
    const title = n ? t('booking.atTime.lateTitle', { n, name: d.nameOf(c.late[0].id), who, time }) : t('booking.atTime.overTitle', { who, time });
    const text = lines(
      ...c.late.map((s) => {
        const line = t('booking.atTime.lateLine', { name: d.nameOf(s.id), eta: clock(s.etaAfter ?? 0, l), by: duration(s.lateMin, l), from: clock(s.winStart ?? 0, l), to: clock(s.winEnd ?? 0, l) });
        const w = d.lateWindow?.(s, a.day);
        return w ? `${line} ${t('jobs.exact.lateNew', { from: clock(w[0], l), to: clock(w[1], l) })}` : line;
      }),
      c.overHours > 0 && t('booking.atTime.overHours', { by: duration(c.overHours, l) }),
      pushed(c.pushed), told,
      !a.may && t('booking.atTime.notYou'));
    return a.may
      ? { title, text, ok: t('booking.atTime.force', { time }), cancel: t('booking.atTime.other'), danger: true }
      : { title, text, ok: t('booking.atTime.other'), cancel: t('common.close') };
  }
  if (c.kind === 'unsure') {
    return { title: t('booking.atTime.question', { name: who, when: dayInSentence(a.day, l), time }),
      text: lines(t(c.why === 'unmeasured' ? 'booking.atTime.unmeasured' : 'booking.atTime.unchecked'), told), ok: t('booking.atTime.anyway'), cancel: t('common.cancel') };
  }
  return null;
}

/** « Pas possible à 8 h » with the earliest (null: the server did not say it) */
export function earlyQuestion(c: { earliest: number | null; keep: number | null }, a: { name: string; at: number }, d: Pick<AtTimeDeps, 'windowOf'>): Question | null {
  if (c.earliest == null) return null;
  const l = lang.value;
  const time = clock(a.at, l), earliest = clock(c.earliest, l);
  const win = d.windowOf(c.earliest);
  return {
    title: t('booking.atTime.earlyTitle', { time }),
    text: lines(t('booking.atTime.early', { name: a.name || t('booking.atTime.someone'), time, earliest }),
      win[0] !== d.windowOf(a.at)[0] && t('booking.atTime.earlyTold', { earliest, from: clock(win[0], l), to: clock(win[1], l) }),
      c.keep != null && c.keep !== c.earliest && t('booking.atTime.earlyKeep', { time: clock(c.keep, l) })),
    ok: t('booking.atTime.earlyOk', { earliest }), cancel: t('booking.atTime.other')
  };
}

/** asks, then books AT that minute; never throws (a refusal is given back for the caller to say) */
export async function bookAtTime(a: AtTimeAsk, d: AtTimeDeps): Promise<AtTimeDone> {
  if (!d.online()) return { kind: 'fallback' };
  const day = a.job.day as Day;
  let at = a.at;
  let again = false;
  let chosen = false;
  for (let round = 0; ; round++) {
    if (round >= 4) return { kind: 'stopped', why: 'rounds' };
    const c = await previewCase(a, d, at);
    if (c.kind === 'fallback') return round === 0 ? { kind: 'fallback' } : { kind: 'stopped', why: 'offline' };
    if (c.kind === 'refused') return { kind: 'refused', error: c.error ?? new Refused(c.code, codeWords(c.code, 'book_job') ?? t('booking.atTime.unchecked')) };
    if (c.kind === 'early') {
      const q = earlyQuestion(c, { name: a.name, at }, d);
      if (!q) return { kind: 'refused', error: new Refused(ARRIVE_LATE, codeWords(ARRIVE_LATE, 'book_job') ?? t('errors.arrive_late')) };
      if (!(await d.ask(q))) return { kind: 'stopped' };
      at = c.earliest!;
      chosen = true;
      continue;
    }
    const may = c.answer?.mayForce ?? a.mayForce;
    // « Mettre à … » already said yes to that minute, or to this booking before the day changed: asked again only when
    // there is something new to hear (somebody late)
    const q = atQuestion(c, { name: a.name, day, at, may }, d);
    if (q && (c.kind === 'late' || !(chosen || again))) {
      const yes = await d.ask(q);
      if (c.kind === 'late' && !may) return { kind: 'stopped', why: 'mechanic' };
      if (!yes) return { kind: 'stopped' };
    }
    const truck = c.answer?.truckId ?? a.truck;
    try {
      const r = await d.book(bookAtJob(a.job, at, truck, lateOkOf(c, a.job.id!)), a.lines);
      const ans = bookAtAnswer(r.data) ?? c.answer ?? null;
      const others = (ans?.stops ?? []).filter((s) => s.id !== a.job.id);
      return {
        kind: 'booked', at, id: r.id || a.job.id!, data: r.data, answer: ans,
        late: others.filter((s) => s.late).map((s) => s.id),
        pushed: others.filter((s) => !s.late && s.delay > 0).map((s) => s.id),
        forced: ans?.forced ?? c.kind === 'late'
      };
    } catch (e) {
      if (noSignal(e)) return { kind: 'stopped', why: 'offline' };
      // sent, but its answer was lost: it may well be booked. Never « réessaie » on a booking that may have happened
      if (isNetworkError(e) && classify(e).sub !== 'busy') return { kind: 'stopped', why: 'lost' };
      const code = exactRefusal(e)?.code;
      if (!again && (code === LATE_CHANGED || code === ARRIVE_LATE)) { again = true; continue; }
      return { kind: 'refused', error: e };
    }
  }
}
