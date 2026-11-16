/* Sends the appointments of a visit, one car after the other, and says what became of each. No screen here: the server
   calls and the question « Réserver quand même » come in as `deps` (send.test.ts runs it against a pretend server). */
import { refusalCode } from '../../domain/moment/logic';
import type { BlockChoice } from '../../domain/moment/choice';
import type { BookInput, ItemInput } from '../../data/api';
import { forcedJob, type VisitJob } from './visit';

/** the refusals « Réserver quand même » can go past (owner and office) */
export const FORCEABLE = ['block_full', 'truck_full'];

export type CarResult =
  /** `sentForced`: sent with « Réserver quand même » (no window asked: the server cut it); `forced`: the server put it
      in a full moment */
  | { key: string; status: 'booked'; id: string; forced: boolean; sentForced: boolean }
  /** no answer in time (no signal, slow server): kept on the phone, sent when the network is back */
  | { key: string; status: 'queued' }
  /** `declined`: the person said no to « Réserver quand même » */
  | { key: string; status: 'refused'; code: string; msg: string; declined: boolean };

export interface SendDeps {
  book: (job: BookInput, lines: ItemInput[]) => Promise<{ queued: boolean; id: string; data?: { forced?: boolean } }>;
  walkIn: (job: Omit<BookInput, 'day' | 'block'>, lines: ItemInput[]) => Promise<{ queued: boolean; id: string }>;
  /** « Ce bloc est plein » → true: book anyway */
  askForce: (msg: string) => Promise<boolean>;
  message: (e: unknown) => string;
}

/** each car in turn; the first refusal stops the visit (the cars after it were not sent: they stay on the screen with
    those refused). « Réserver quand même » is asked once for the visit: the same moment for every car. */
export async function sendVisit(jobs: VisitJob[], o: { walkIn: boolean; choice: BlockChoice | null; mayForce: boolean }, deps: SendDeps): Promise<CarResult[]> {
  const out: CarResult[] = [];
  let force: boolean | null = null;
  for (const v of jobs) {
    const r = await sendOne(v, o, deps, force, (yes) => { force = yes; });
    out.push(r);
    if (r.status === 'refused') break;
  }
  return out;
}

async function sendOne(v: VisitJob, o: { walkIn: boolean; choice: BlockChoice | null; mayForce: boolean }, deps: SendDeps, force: boolean | null, said: (yes: boolean) => void, forced = false): Promise<CarResult> {
  try {
    if (o.walkIn) {
      const { day: _d, block: _b, ...job } = v.job;
      const r = await deps.walkIn(job, v.lines);
      return r.queued ? { key: v.key, status: 'queued' } : { key: v.key, status: 'booked', id: r.id || v.job.id!, forced: false, sentForced: false };
    }
    const job = forced && o.choice ? forcedJob(v.job, o.choice) : v.job;
    const r = await deps.book(job, v.lines);
    return r.queued ? { key: v.key, status: 'queued' } : { key: v.key, status: 'booked', id: r.id || v.job.id!, forced: !!r.data?.forced, sentForced: forced };
  } catch (e) {
    const code = refusalCode(e);
    const msg = deps.message(e);
    if (!o.walkIn && !forced && o.mayForce && FORCEABLE.includes(code)) {
      const yes = force ?? await deps.askForce(msg);
      said(yes);
      if (yes) return sendOne(v, o, deps, yes, said, true);
      return { key: v.key, status: 'refused', code, msg, declined: true };
    }
    return { key: v.key, status: 'refused', code, msg, declined: false };
  }
}
