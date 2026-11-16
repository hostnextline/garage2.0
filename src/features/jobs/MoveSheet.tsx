/* « Déplacer »: another day and block (or arrival window), with the « garde-route » question when the moment puts too much
   road in the truck's day; then, when the « moved » text is on, the customer gets it by itself. */
import { useState } from 'preact/hooks';
import type { Job } from '../../data/types';
import { Sheet, Button, toast, ask } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { settings, windowsOn } from '../../data/select';
import { moveJob, errorMessage } from '../../data/api';
import { BlockPicker, type BlockChoice, type FarInfo } from '../../shared/moment/BlockPicker';
import { windowWords } from '../../domain/moment/words';
import { sameMoment, moveWindow, choiceWindow, farQuestion } from '../../domain/moment/logic';
import { jobCustomer, dayInSentence, wt } from '../../shared/jobs/select';
import { sendText } from '../../shared/jobs/texts';
import { afterSheet } from './scroll';

export function MoveSheet(p: { job: Job; open: boolean; onClose: () => void }) {
  if (!p.open) return null;
  return <MoveOpen job={p.job} onClose={p.onClose} />;
}
/** « jeudi 6 novembre, après-midi »; a window: « jeudi 6 novembre, entre 14 h et 18 h » */
function movedWhen(c: BlockChoice): string {
  if (c.block !== 'day') return `${dayInSentence(c.day)}, ${t(`common.blocks.${c.block}`).toLowerCase()}`;
  const b = settings.value.booking;
  const w = choiceWindow(c, (b.win_before_min ?? 60) + (b.win_after_min ?? 180));
  // neither a window nor « flexible »: the server gives the window, only the day is sure
  return w || c.win_flex ? `${dayInSentence(c.day)}, ${windowWords(w, lang.value)}` : dayInSentence(c.day);
}
function MoveOpen(p: { job: Job; onClose: () => void }) {
  const { job: j } = p;
  const [choice, setChoice] = useState<BlockChoice | null>(null);
  // « garde-route »: the moment chosen puts too much road in the truck's day (said by the block picker)
  const [far, setFar] = useState<FarInfo | null>(null);
  const c = jobCustomer(j);
  const textOn = !!settings.value.messages?.on?.moved;
  // « Plages d'arrivée »: the picker's choice carries the window chosen (or « flexible »)
  const same = !!choice && sameMoment(choice, j) && !choice.truck_id;
  const move = async () => {
    if (!choice) return;
    const farAsk = farQuestion(far, choice, 'move');
    if (farAsk && !(await ask(farAsk))) return;
    try {
      const r = await moveJob(j.id, choice.day, choice.block, choice.truck_id ?? null, moveWindow(choice));
      const d = r.data as { changed?: boolean; unchanged?: boolean } | undefined;
      if (r.queued) toast(t('shell.queued'));
      else if (d?.unchanged) toast(t('jobs.moment.same'));
      else toast(t('jobs.moment.moved', { when: movedWhen(choice) }), { kind: 'ok' });
      p.onClose();
      if (!r.queued && !d?.unchanged && textOn) afterSheet(() => { void sendText('moved', j); });
    } catch (e) {
      toast(errorMessage(e), { kind: 'bad' });
    }
  };
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.moment.moveTitle')} sub={wt({ block: windowsOn.value ? 'day' : 'am' }, textOn ? 'jobs.moment.moveLeadText' : 'jobs.moment.moveLead')} wide data-testid="move-sheet"
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={!choice || same} onClick={move} data-testid="move-ok">{t('jobs.moment.moveOk')}</Button></>}>
      <BlockPicker lat={j.lat ?? c?.lat ?? null} lng={j.lng ?? c?.lng ?? null} address={j.address || c?.address || null} duration={j.duration_min} excludeJob={j.id} value={choice} onPick={setChoice} onFar={setFar} />
    </Sheet>
  );
}
