/* « Texter Julie ? » (Hassan, 2026-11-22: « i do not want them to receive a text automatically when i change their
   appointement. the system should ask me first »). After any change of an appointment that used to send the « moved »
   text by itself (« Déplacer », the agenda's drag, its hour grid and its list of windows, the move to an exact time,
   « Changer de camion », a move kept on the phone that reaches the server later), the app sends NOTHING and asks here:
   the new moment in words (the day, and the window or the block, as the text says it), « Envoyer le texto » (then the very
   send of before, with all its outcomes: sent, to send by hand, failed, already sent…) or « Pas de texto » (closing the
   sheet is « Pas de texto »). The ONE question of every path: none of them sends the « moved » text itself any more.
   Asked only when a text would have gone: the caller's rule (what the customer was told changed, the switch on), and the
   customer has a number that takes texts (wantsText; Réglages → Textos « Rendez-vous changé » off: never asked).
   Two changes of the same appointment before the answer: one question, saying the latest moment (read live; the row as
   it was right after the move when the phone no longer holds it). Two appointments: one question each, one after the
   other, the next one only once the send of the one before answered and its « text to send by hand » sheet closed.
   The sheet lives in its own little root (as the « booking-sms » sheet): it is asked wherever the person is when a move
   kept on the phone lands, as the text went until now; « Envoyer le texto » on a screen with no « text to send by
   hand » host answers with the agenda's send, whose sheet has its own root, so the person always sees what happened.
   A navigation (the « Voir » of the move's message) never answers it: it rises again on the next screen. */
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
import { sendText, outcome, outcomeClosed } from './texts';
import { hostMounted } from './hosts';
import './jobs.css';

/** which send « Envoyer le texto » runs: the agenda's (notifyCustomer: its « texto à envoyer » sheet in its own root) or the
    job screens' (sendText: the « text to send by hand » sheet of the screen's host). The very one each path used before. */
export type TextVia = 'notify' | 'jobs';
interface Asked {
  jobId: string;
  via: TextVia;
  /** the job as the caller had it (« Déplacer » passes it as its sheet showed it, before the move): its name only */
  job: Job | null;
  /** the job right after the move (move_job's row, else the phone's row when asked), said when the phone no longer
      holds it: never the moment of before the move */
  after: Job | null;
  seq: number;
}
const asked = signal<Asked[]>([]);
let seq = 0;
/** a send under way (its answer, then its « text to send by hand » sheet): the next question waits for it */
const sending = signal(false);
/** closed by a navigation: hidden until the next screen is there, then shown again (`round` gives it a new step) */
const away = signal(false);
let round = 0;
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
  // the moment right after the move, taken now (the server's rows are in): what the question says if the row leaves
  const after = o.after ?? jobRow(id) ?? null;
  setTimeout(() => whenHistorySettled(() => {
    ensureHost();
    const list = asked.peek();
    const i = list.findIndex((a) => a.jobId === id);
    // the same appointment changed again before the answer: still one question (it says the moment as it is now)
    if (i >= 0) {
      const a = list[i];
      asked.value = [...list.slice(0, i), { ...a, via: o.via, job: job ?? a.job, after: after ?? a.after }, ...list.slice(i + 1)];
      return;
    }
    asked.value = [...list, { jobId: id, via: o.via, job, after, seq: ++seq }];
  }), 0);
  return true;
}

/** the questions waiting (tests): the appointments, in order */
export const textAsksWaiting = (): string[] => asked.value.map((a) => a.jobId);
/** forgets every question (tests) */
export function clearTextAsks() { asked.value = []; sending.value = false; away.value = false; }

/** « Envoyer le texto »: the very send of before. The job screens' send (its « text to send by hand » sheet is drawn by
    the screen's host) only where such a host is; elsewhere (a move kept on the Carte that lands while the person is on
    the agenda) the agenda's send, whose sheet has its own root: never a tap answered by nothing. Resolves once it
    answered and its « text to send by hand » sheet, if any, is closed. */
async function sendNow(a: Asked): Promise<void> {
  if (a.via === 'jobs' && hostMounted('text-outcome')) {
    // the job as the server will text it now (« Changer de client » meanwhile: the toast names the one texted)
    const j = jobRow(a.jobId) ?? a.after ?? a.job;
    if (!j) return;
    await sendText('moved', j);
    if (outcome.peek()) await outcomeClosed();
    return;
  }
  await notifyCustomer('moved', a.jobId);
}

/** a navigation closed the question: it comes back once the new screen is there (after the navigation's own steps) */
function cameBack() {
  away.value = true;
  setTimeout(() => whenHistorySettled(() => { round++; away.value = false; }), 0);
}

export function TextAskHost() {
  const a = asked.value[0];
  if (!a || sending.value || away.value) return null;
  // the moment as the phone holds it now (the latest), else as it was right after the move (never the one before it)
  const now = jobRow(a.jobId) ?? a.after;
  const done = (send: boolean) => {
    if (asked.peek()[0] !== a || sending.peek()) return;               // already answered (a second tap)
    asked.value = asked.peek().slice(1);
    if (!send) return;
    sending.value = true;
    void sendNow(a).catch(() => undefined).finally(() => { sending.value = false; });
  };
  const who = now ?? a.job;
  const name = who ? jobFirstName(who) : '';
  const k = `${a.seq}-${round}`;
  return (
    <Sheet key={k} open onClose={() => done(false)} onNavigate={cameBack} title={t('jobs.textAsk.title', { name })} data-testid="text-ask"
      footer={<>
        <Button key={`n${k}`} hold={TEXT_ASK_DEAD_MS} onClick={() => done(false)} data-testid="text-ask-skip">{t('jobs.textAsk.skip')}</Button>
        <Button key={`y${k}`} hold={TEXT_ASK_DEAD_MS} variant="primary" icon={<MessageSquareText />} onClick={() => done(true)} data-testid="text-ask-send">{t('jobs.textAsk.send')}</Button>
      </>}>
      {now && <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('jobs.textAsk.lead')}</p>
        <p class="jobs-msgbox" data-testid="text-ask-when">{movedWhen(now)}</p>
      </div>}
    </Sheet>
  );
}
