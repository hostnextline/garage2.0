/* « Déplacer » from a list of a truck's stops, on that very screen (Hassan, 2026-11-21: « move apts time from here »): the
   Carte, Vue d'ensemble and Aujourd'hui each mount one MoveHost; their « Déplacer » (a button, or the shortcut menu's)
   calls openMove(id) and the app's one move sheet (MoveSheet) rises over the screen, which stays where it was. The same
   move, the same rules and rights as on the appointment's screen; nothing new on the server.
   After the move the screen follows by itself (the phone's copy gets the server's rows; `onMoved` lets a screen that
   shows the server's own answer, the Carte, ask it again) and the sheet's message says where it went, a few seconds
   longer than usual, with « Voir » (the appointment). A move kept on the phone (no signal) marks the appointment
   « waiting » until it leaves, so no second move is offered behind it (the agenda's rule), and once it reaches the server
   the customer gets the « moved » text when what they were told changed (the agenda's textWhenSent). The sheet closes
   by itself when the appointment may no longer be moved (under way by realtime) or leaves the phone. The « text to send
   by hand » sheet of the customer's « moved » text has its host here too. */
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { Job } from '../../data/types';
import { job as jobRow, settings } from '../../data/select';
import { t } from '../../lib/i18n';
import { toast } from '../../ui';
import { jobRights } from '../../domain/jobs/rights';
import { moveTextGoes } from '../../domain/jobs/move';
import { toldChanged } from '../../domain/moment/moveRules';
import { MoveSheet } from './MoveSheet';
import { TextOutcomeHost } from './TextOutcome';
import { mayMove, moveSettled, setWaiting, noteMoved } from './moving';
import { sendText } from './texts';
import { seen } from './select';

/** the appointment whose move sheet is open on this screen */
const moving = signal<string | null>(null);
/** what had the focus when it opened (the row, the card's button): given back when it closes (computer, keyboard) */
let opener: HTMLElement | null = null;

/** opens the move sheet of this appointment on the screen, when this person may move it now (booked, « Réserver », no
    move of it waiting on the phone); else nothing */
export function openMove(j: Pick<Job, 'id'> | string) {
  const id = typeof j === 'string' ? j : j.id;
  const row = jobRow(id);
  if (!row || !mayMove(seen(row))) return;
  opener = focusBefore();
  moving.value = id;
}
/** the sheet open now (tests) */
export const moveOpenFor = () => moving.value;

/** the element to give the focus back to: the one focused, or, when the shortcut menu had it, the row it opened from */
function focusBefore(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && !a.closest('[data-testid="agenda-menu"]')) return a;
  return menuOpener;
}
/** the last row whose shortcut menu was opened (shortcuts.tsx notes it) */
let menuOpener: HTMLElement | null = null;
export function noteMenuOpener(el: EventTarget | null) {
  const h = el as HTMLElement | null;
  menuOpener = h && typeof h.closest === 'function' ? (h.closest('a,button,[tabindex]') as HTMLElement | null) ?? h : null;
}
function giveFocusBack() {
  const el = opener;
  opener = null;
  // after the sheet gave back its own focus (it remembered the menu's item, already gone)
  setTimeout(() => { if (el && el.isConnected && typeof el.focus === 'function') el.focus(); }, 0);
}

/** the customer's text once a move kept on the phone reaches the server: when its answer says what they were told
    changed (`tell`), or, already sent meanwhile, when the phone's row says it (the agenda's textWhenSent). Refused:
    nothing (the frame's « refusé » list says so). The « waiting » mark stays until then. */
async function whenSent(before: Job, wanted: boolean) {
  setWaiting(before.id, true);
  try {
    const s = await moveSettled(before.id);
    if (!wanted) return;
    const goes = s.kind === 'done' ? moveTextGoes({ queued: false, data: s.data }, before, jobRow(before.id), true)
      : s.kind === 'gone' ? (() => { const after = jobRow(before.id); return !!after && toldChanged(before, after); })()
      : false;
    if (goes) void sendText('moved', before);
  } catch { /* nothing more to do: the job screen still offers the text */ } finally {
    setWaiting(before.id, false);
  }
}

/** booked and the right (what realtime can change while the sheet is open); the « waiting » part is the sheet's own
    move being sent, never a reason to close it */
const stillMovable = (j: Job) => j.status === 'booked' && jobRights(j).move;

export function MoveHost(p: { onMoved?: (j: Job) => void }) {
  // leaving the screen forgets it: the sheet never rises later on another screen
  useEffect(() => () => { moving.value = null; opener = null; }, []);
  const id = moving.value;
  const row = id ? jobRow(id) : undefined;
  const gone = !!id && !row;
  const stale = !!row && !stillMovable(seen(row));
  // the appointment left the phone (another truck's, a narrow copy) or may no longer be moved (under way, by realtime):
  // the sheet closes, never comes back by itself; a stop gone under way says why
  useEffect(() => {
    if (!gone && !stale) return;
    moving.value = null;
    if (stale) toast(t('errors.not_booked'));
  }, [gone, stale]);
  const close = () => { moving.value = null; giveFocusBack(); };
  const sent = (j: Job) => (r: { queued: boolean }) => {
    if (r.queued) { void whenSent(j, !!settings.value.messages?.on?.moved); return; }
    noteMoved(j.id);
    p.onMoved?.(j);
  };
  return (
    <>
      {row && !stale && <MoveSheet key={row.id} job={row} open onClose={close} onSent={sent(row)} fromList />}
      <TextOutcomeHost />
    </>
  );
}
