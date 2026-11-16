/* What the screen says and does after « Réserver », from what became of each car. Pure (outcome.test.ts): the words
   come in as two functions, `t` (the same in both modes) and `bt` (the « Plages d'arrivée » twin when the garage books
   by windows). */
import { BLOCK_REFUSALS } from '../../domain/moment/logic';
import type { CarResult } from './send';

export interface Said { text: string; kind: 'ok' | 'bad' | 'info'; ms?: number }
export interface Outcome {
  /** the toasts, in order */
  toasts: Said[];
  /** where the screen goes (replacing itself); null: it stays for another try */
  go: string | null;
  /** the appointments answered by the server: their confirmation text may go now */
  texts: string[];
  /** the cars booked or kept on the phone: they leave the screen for good */
  done: string[];
  /** the red line above the moments; `windowGone`: the window chosen can no longer be kept, the picker asks again */
  banner: string | null;
  windowGone: boolean;
}
type Words = (key: string, vars?: Record<string, string | number>) => string;

/** the server's sentence, with « Choisis un autre bloc. » after it unless it already says so */
export function withHint(msg: string, hint: string): string {
  const bare = hint.trim().replace(/\.$/, '').toLowerCase();
  return msg.toLowerCase().includes(bare) ? msg : `${msg} ${hint}`.trim();
}

export function outcome(results: CarResult[], o: { total: number; walkIn: boolean; day: string | null; when: string }, w: { t: Words; bt: Words }): Outcome {
  const done = results.filter((r) => r.status !== 'refused');
  const booked = results.flatMap((r) => (r.status === 'booked' ? [r] : []));
  const queued = results.some((r) => r.status === 'queued');
  const refused = results.find((r): r is Extract<CarResult, { status: 'refused' }> => r.status === 'refused');
  const out: Outcome = { toasts: [], go: null, texts: booked.map((r) => r.id), done: done.map((r) => r.key), banner: null, windowGone: false };

  if (refused) {
    if (refused.code === 'window_full') {
      const msg = w.t('booking.win.full');
      out.toasts.push({ text: msg, kind: 'bad' });
      out.banner = msg;
      out.windowGone = true;
    } else {
      // a « Réserver quand même » declined was said in the question already
      if (!refused.declined) out.toasts.push({ text: refused.msg, kind: 'bad' });
      if (BLOCK_REFUSALS.includes(refused.code)) out.banner = withHint(refused.msg, w.bt('refusedBlock'));
    }
    if (done.length) out.toasts.push({ text: w.bt('cars.partial', { n: done.length, total: o.total }), kind: 'bad', ms: 9000 });
    return out;
  }
  if (o.walkIn) {
    if (queued) { out.toasts.push({ text: w.t('booking.queuedWalkIn'), kind: 'info', ms: 9000 }); out.go = '/'; }
    else if (o.total === 1) { out.toasts.push({ text: w.t('booking.doneWalkIn'), kind: 'ok' }); out.go = `/job/${booked[0].id}`; }
    else { out.toasts.push({ text: w.t('booking.cars.done', { n: done.length, when: '' }), kind: 'ok', ms: 9000 }); out.go = '/'; }
    out.texts = [];
    return out;
  }
  const agenda = `/agenda/${o.day}`;
  // kept on the phone: placed (and refused, if it must be) when the network is back; its text is sent from
  // « À confirmer » once it is placed, the answered ones get theirs now
  if (queued) { out.toasts.push({ text: w.bt('queued'), kind: 'info', ms: 10000 }); out.go = agenda; return out; }
  if (o.total === 1) {
    const forced = booked[0].forced;
    out.toasts.push({ text: w.t(forced ? 'booking.force.done' : 'booking.done', { when: o.when }), kind: forced ? 'info' : 'ok', ms: forced ? 9000 : undefined });
    out.go = `/job/${booked[0].id}`;
    return out;
  }
  out.toasts.push({ text: w.t('booking.cars.done', { n: done.length, when: o.when }), kind: 'ok', ms: 9000 });
  out.go = agenda;
  return out;
}
