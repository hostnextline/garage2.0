/* « Texter Julie ? » (Hassan, 2026-11-22: « i do not want them to receive a text automatically when i change their
   appointement. the system should ask me first »). After any change of an appointment that used to send the « moved »
   text by itself (« Déplacer », the agenda's drag, its hour grid and its list of windows, the move to an exact time,
   « Changer de camion », a move kept on the phone that reaches the server later), the app sends NOTHING and asks here:
   the new moment in words (the day, and the window or the block, as the text says it), « Envoyer le texto » (then the very
   send of before, with all its outcomes: sent, to send by hand, failed, already sent…) or « Pas de texto » (closing the
   sheet is « Pas de texto »). The ONE question of every path: none of them sends the « moved » text itself any more.
   Asked only when a text would have gone: the caller's rule (what the customer was told changed, the switch on), and the
   customer has a number that takes texts (wantsText; Réglages → Textos « Rendez-vous changé » off: never asked).
   Two changes of the same appointment before the answer: one question, saying the latest moment (read live). Two
   appointments: one question each, one after the other. The sheet lives in its own little root (as the « booking-sms »
   sheet): it is asked wherever the person is when a move kept on the phone lands, as the text went until now. */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { MessageSquareText } from 'lucide-preact';
import type { Job } from '../../data/types';
import { job as jobRow } from '../../data/select';
import { t } from '../../lib/i18n';
import { Sheet, Button, whenHistorySettled } from '../../ui';
import { notifyCustomer, wantsText } from '../moment/notify';
import { blockRange, capFirst, dayInSentence, isWindowJob, momentWord } from '../../domain/jobs/when';
import { jobFirstName } from './select';
import { sendText } from './texts';
import './jobs.css';

/** which send « Envoyer le texto » runs: the agenda's (notifyCustomer: its « texto à envoyer » sheet in its own root) or the
    job screens' (sendText: the « text to send by hand » sheet of the screen's host). The very one each path used before. */
export type TextVia = 'notify' | 'jobs';
interface Asked {
  jobId: string;
  via: TextVia;
  /** the job as the caller had it (« Déplacer » passes it as its sheet showed it, before the move: sendText's own rule) */
  job: Job | null;
  /** the job as the server wrote it (move_job's row), when the phone does not hold it: said only then */
  after: Job | null;
  seq: number;
}
const asked = signal<Asked[]>([]);
let seq = 0;
/** a question just shown ignores answers this long (the second tap of a double tap on « Déplacer » never answers it) */
export const TEXT_ASK_DEAD_MS = 400;

let host: HTMLElement | null = null;
function ensureHost() {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.dataset.owner = 'text-ask';
  document.body.appendChild(host);
  render(<TextAskHost />, host);
}

/** the new moment as the « moved » text says it: « Mardi 24 novembre, entre 13 h et 17 h »; a block: « Mardi 24 novembre,
    après-midi (12 h à 16 h) » */
export function movedWhen(j: Pick<Job, 'day' | 'block' | 'win_start' | 'win_end' | 'win_flex'>): string {
  const day = capFirst(dayInSentence(j.day));
  return isWindowJob(j) ? `${day}, ${blockRange(j)}` : `${day}, ${momentWord(j)} (${blockRange(j)})`;
}

/** after a change that would have texted the customer (the caller's rule said so): asks first, never sends by itself.
    Nothing is asked when the customer has no number or takes no texts, or « Rendez-vous changé » is off (false). Opened
    once the sheet that made the change gave back its history step. True when a question is (or already was) waiting. */
export function askMovedText(j: Job | string, o: { via: TextVia; after?: Job | null }): boolean {
  const id = typeof j === 'string' ? j : j.id;
  if (!wantsText('moved', id)) return false;
  const job = typeof j === 'string' ? null : j;
  setTimeout(() => whenHistorySettled(() => {
    ensureHost();
    const list = asked.peek();
    const i = list.findIndex((a) => a.jobId === id);
    // the same appointment changed again before the answer: still one question (it says the moment as it is now)
    if (i >= 0) {
      const a = list[i];
      asked.value = [...list.slice(0, i), { ...a, via: o.via, job: job ?? a.job, after: o.after ?? a.after }, ...list.slice(i + 1)];
      return;
    }
    asked.value = [...list, { jobId: id, via: o.via, job, after: o.after ?? null, seq: ++seq }];
  }), 0);
  return true;
}

/** the questions waiting (tests): the appointments, in order */
export const textAsksWaiting = (): string[] => asked.value.map((a) => a.jobId);
/** forgets every question (tests) */
export function clearTextAsks() { asked.value = []; }

/** « Envoyer le texto »: the very send of before */
function sendNow(a: Asked) {
  if (a.via === 'notify') { void notifyCustomer('moved', a.jobId); return; }
  const j = a.job ?? jobRow(a.jobId) ?? a.after;
  if (j) void sendText('moved', j);
}

export function TextAskHost() {
  const a = asked.value[0];
  if (!a) return null;
  // the moment as the phone holds it now (the server's rows of the move are in), else as the move's answer wrote it
  const now = jobRow(a.jobId) ?? a.after ?? a.job;
  const done = (send: boolean) => {
    if (asked.peek()[0] !== a) return;                                  // already answered (a second tap)
    asked.value = asked.peek().slice(1);
    if (send) sendNow(a);
  };
  const name = now ? jobFirstName(now) : '';
  return (
    <Sheet open onClose={() => done(false)} title={t('jobs.textAsk.title', { name })} data-testid="text-ask"
      footer={<>
        <Button key={`n${a.seq}`} hold={TEXT_ASK_DEAD_MS} onClick={() => done(false)} data-testid="text-ask-skip">{t('jobs.textAsk.skip')}</Button>
        <Button key={`y${a.seq}`} hold={TEXT_ASK_DEAD_MS} variant="primary" icon={<MessageSquareText />} onClick={() => done(true)} data-testid="text-ask-send">{t('jobs.textAsk.send')}</Button>
      </>}>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('jobs.textAsk.lead')}</p>
        {now && <p class="jobs-msgbox" data-testid="text-ask-when">{movedWhen(now)}</p>}
      </div>
    </Sheet>
  );
}
