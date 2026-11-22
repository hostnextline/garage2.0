/* « Déplacer »: another day and block (or arrival window), with the « garde-route » question when the moment puts too much
   road in the truck's day; then, when the « moved » text is on and what the customer was told changed, the question
   « Texter … ? » (textAsk.tsx: Hassan, 2026-11-22, nothing goes by itself). The one sheet of the app:
   the appointment's screen opens it (features/jobs/JobSheet.tsx), and so do the lists of a truck's stops, on their own
   screen (MoveHost: Carte, Vue d'ensemble, Aujourd'hui). Moved here from features/jobs, unchanged but for `onSent` and
   `fromList` (the lists of stops only; the appointment's screen passes neither and behaves as before).
   « exact move » (Hassan, 2026-11-21; STATE.md A1, A2): with arrival windows, a time the picker showed (a quarter hour of
   the calendar, on a computer or a phone; a best moment's « Vers … ») is where the appointment lands: the one flow of
   exactMove.ts (the preview, a question only when somebody would be later or late, the truck cannot be there, or it
   could not be checked; « Garde-route »; the move to that minute, never kept on the phone). « Flexible », the day alone
   and the blocks move as before. */
import { useState } from 'preact/hooks';
import type { Job } from '../../data/types';
import { Sheet, Button, toast, ask } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { settings, windowsOn, job as jobRow, daySpan, windowOf } from '../../data/select';
import { navigate } from '../../platform/router';
import { wantsText } from '../moment/notify';
import { moveJob, errorMessage } from '../../data/api';
import { BlockPicker, type BlockChoice, type FarInfo } from '../moment/BlockPicker';
import { windowWords } from '../../domain/moment/words';
import { sameMoment, moveWindow, choiceWindow, farQuestion } from '../../domain/moment/logic';
import { moveTextGoes } from '../../domain/jobs/move';
import { exactAtOf } from '../../domain/moment/exactAt';
import { dropTells } from '../../domain/moment/moveRules';
import { jobCustomer, dayInSentence, wt } from './select';
import { askMovedText } from './textAsk';
import { moveAt, doneWords } from './exactMove';

/** what moveJob gave: kept on the phone (`queued`), or the server's answer */
export type MoveSent = { queued: boolean; data?: unknown };

/** `onSent`: told once the move went (moved, nothing to change, or kept on the phone), before the sheet closes.
    `fromList`: opened from a list of a truck's stops (MoveHost), where the stop leaves the list once moved: the message
    stays 6 s with « Voir » (the appointment's screen), a move kept on the phone says the question « Texter … ? » follows
    once sent (MoveHost asks it), and window mode opens the picker on the stop's own day (another hour the same day: one
    tap less). */
export function MoveSheet(p: { job: Job; open: boolean; onClose: () => void; onSent?: (r: MoveSent) => void; fromList?: boolean }) {
  if (!p.open) return null;
  return <MoveOpen job={p.job} onClose={p.onClose} onSent={p.onSent} fromList={p.fromList} />;
}
/** « jeudi 6 novembre, après-midi »; a window: « jeudi 6 novembre, entre 14 h et 18 h » */
function movedWhen(c: BlockChoice): string {
  if (c.block !== 'day') return `${dayInSentence(c.day)}, ${t(`common.blocks.${c.block}`).toLowerCase()}`;
  const b = settings.value.booking;
  const w = choiceWindow(c, (b.win_before_min ?? 60) + (b.win_after_min ?? 180));
  // neither a window nor « flexible »: the server gives the window, only the day is sure
  return w || c.win_flex ? `${dayInSentence(c.day)}, ${windowWords(w, lang.value)}` : dayInSentence(c.day);
}
function MoveOpen(p: { job: Job; onClose: () => void; onSent?: (r: MoveSent) => void; fromList?: boolean }) {
  const { job: j } = p;
  const [choice, setChoice] = useState<BlockChoice | null>(null);
  // « garde-route »: the moment chosen puts too much road in the truck's day (said by the block picker)
  const [far, setFar] = useState<FarInfo | null>(null);
  const c = jobCustomer(j);
  const textOn = !!settings.value.messages?.on?.moved;
  // « Plages d'arrivée »: the picker's choice carries the window chosen (or « flexible »); « exact move »: the time it showed
  const at = choice && windowsOn.value ? exactAtOf(choice, daySpan.value, windowOf) : null;
  // nothing to move: the same moment (with a time shown: the same day and the same planned arrival; another quarter hour
  // of the same window IS a move now)
  const same = !!choice && !choice.truck_id && (at != null ? j.block === 'day' && choice.day === j.day && j.eta_min === at : sameMoment(choice, j));
  const [busy, setBusy] = useState(false);
  const said = (when: string) => {
    if (p.fromList) toast(when, { kind: 'ok', ms: 6000, action: { label: t('jobs.moment.see'), run: () => navigate(`/job/${j.id}`) } });
    else toast(when, { kind: 'ok' });
  };
  /** to that very minute (A1, A2): the flow asks what it has to, the sheet stays open when the person picks another time */
  const moveExact = async (c: BlockChoice, m: number) => {
    // « L'app te demandera ensuite s'il faut texter … » only when what the customer was told changes (another day or window)
    const sms = textOn && wantsText('moved', j.id) && dropTells(j, c.day, windowOf(m)[0]);
    const d = await moveAt({ job: j, day: c.day, truck: null, at: m, confirm: false, sms, offered: c.truck ?? null,
      far: async () => farQuestion(far, c, 'move') });
    if (d.kind === 'stopped') return;
    if (d.kind === 'refused') { toast(errorMessage(d.error), { kind: 'bad' }); return; }
    const r = { queued: false, data: d.r.data };
    if ((d.r.data as { unchanged?: boolean } | undefined)?.unchanged) toast(t('jobs.moment.same'));
    else said(doneWords(d, c.day));
    p.onSent?.(r);
    p.onClose();
    // the question once this sheet gave back its history step (textAsk waits for it)
    if (moveTextGoes(r, j, jobRow(j.id), textOn)) askMovedText(j, { via: 'jobs' });
  };
  const move = async () => {
    if (!choice || busy) return;
    if (at != null) {
      setBusy(true);
      try { await moveExact(choice, at); } finally { setBusy(false); }
      return;
    }
    const farAsk = farQuestion(far, choice, 'move');
    if (farAsk && !(await ask(farAsk))) return;
    try {
      const r = await moveJob(j.id, choice.day, choice.block, choice.truck_id ?? null, moveWindow(choice));
      const d = r.data as { changed?: boolean; unchanged?: boolean } | undefined;
      if (r.queued) toast(p.fromList && textOn && wantsText('moved', j.id) ? `${t('shell.queued')} ${t('agenda.move.textLater')}` : t('shell.queued'));
      else if (d?.unchanged) toast(t('jobs.moment.same'));
      else said(t('jobs.moment.moved', { when: movedWhen(choice) }));
      p.onSent?.(r);
      p.onClose();
      // the question « Texter … ? » only when what the customer was told changed (the server's `tell`): a truck changed at
      // the same moment, or the same window, says nothing new to them (R84); nothing goes without « Envoyer le texto »
      if (moveTextGoes(r, j, jobRow(j.id), textOn)) askMovedText(j, { via: 'jobs' });
    } catch (e) {
      toast(errorMessage(e), { kind: 'bad' });
    }
  };
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.moment.moveTitle')} sub={wt({ block: windowsOn.value ? 'day' : 'am' }, textOn && wantsText('moved', j.id) ? 'jobs.moment.moveLeadText' : 'jobs.moment.moveLead')} wide data-testid="move-sheet"
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!choice || same} busy={busy} onClick={move} data-testid="move-ok">{t('jobs.moment.moveOk')}</Button></>}>
      <BlockPicker lat={j.lat ?? c?.lat ?? null} lng={j.lng ?? c?.lng ?? null} address={j.address || c?.address || null} duration={j.duration_min} excludeJob={j.id} exactMove value={choice} onPick={setChoice} onFar={setFar} {...(p.fromList ? { openDay: j.day } : {})} />
    </Sheet>
  );
}
