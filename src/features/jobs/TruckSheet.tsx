/* « Changer de camion »: the same day and block (or arrival window), another truck (booked by mistake on the wrong one).
   No text to the customer: the day and the hours do not change (unless the server says they did: `tell`, R84). */
import { useState } from 'preact/hooks';
import { Truck } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Sheet, Button, Rows, RowItem, Pill, toast } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { truckLabel, truckColor, blockLoad, settings, job as jobRow } from '../../data/select';
import { moveJob, errorMessage } from '../../data/api';
import { freeWords } from '../../domain/moment/words';
import { moveTextGoes } from '../../domain/jobs/move';
import { dayInSentence, momentWord, wt } from '../../shared/jobs/select';
import { sendText } from '../../shared/jobs/texts';
import { afterSheet } from './scroll';

export function TruckSheet(p: { job: Job; open: boolean; onClose: () => void }) {
  if (!p.open) return null;
  return <TruckOpen job={p.job} onClose={p.onClose} />;
}
function TruckOpen(p: { job: Job; onClose: () => void }) {
  const { job: j } = p;
  const l = lang.value;
  // the trucks of that block, the appointment's own time left out (it moves with it)
  const load = blockLoad(j.day, j.block, { exclude: j.id });
  const working = load.trucks.filter((x) => x.cap > 0 || x.truck.id === j.truck_id);
  // the truck being sent (or 'auto'): the rows take no second tap meanwhile
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (truckId: string | null) => {
    setBusy(truckId || 'auto');
    try {
      // the same day: the call without a window keeps exactly what the customer was told (its start, its end, « flexible »);
      // sending the window again would cut a new end with today's length and lose « flexible »
      const r = await moveJob(j.id, j.day, j.block, truckId);
      const d = r.data as { unchanged?: boolean } | undefined;
      if (r.queued) toast(t('shell.queued'));
      else if (d?.unchanged) toast(t('jobs.truck.same'));
      else toast(truckId ? t('jobs.truck.done', { truck: truckLabel(truckId) }) : t('jobs.truck.doneAuto'), { kind: 'ok' });
      p.onClose();
      // the day and the hours stay: no text. Only when the server says what the customer was told changed anyway (a job
      // of the other mode converted, its window cut again: `tell`) does the « moved » text go, as from « Déplacer » (R84)
      if (moveTextGoes(r, j, jobRow(j.id), !!settings.value.messages?.on?.moved)) afterSheet(() => { void sendText('moved', j); });
    } catch (e) {
      toast(errorMessage(e), { kind: 'bad' });
    } finally { setBusy(null); }
  };
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.truck.title')} sub={t('jobs.truck.sub', { when: `${dayInSentence(j.day)}, ${momentWord(j)}` })} data-testid="truck-sheet"
      footer={<Button onClick={p.onClose}>{t('common.cancel')}</Button>}>
      <div class="stack">
        <p class="small muted" style={{ margin: 0 }}>{t('jobs.truck.noText')}</p>
        {working.length ? (
          <Rows>
            {working.map((x) => {
              const mine = x.truck.id === j.truck_id;
              const fits = x.cap - x.used >= j.duration_min;
              return (
                <RowItem key={x.truck.id} data-testid={`truck-pick-${x.truck.id}`}
                  start={<span class="jobs-truck-dot" style={{ '--tc': truckColor(x.truck.id) }} aria-hidden="true"><Truck size={18} /></span>}
                  title={<>{truckLabel(x.truck.id)}{mine && <Pill tone="booked">{t('jobs.truck.current')}</Pill>}</>}
                  sub={x.cap > 0 ? `${freeWords(x.used, x.cap, l)}${fits || mine ? '' : `. ${t('jobs.truck.tight', { d: duration(j.duration_min, l) })}`}` : wt(j, 'jobs.truck.off')}
                  onClick={mine || busy ? undefined : () => { void pick(x.truck.id); }} />
              );
            })}
          </Rows>
        ) : <p class="muted">{wt(j, 'jobs.truck.none')}</p>}
        {j.truck_pinned && <Button block onClick={() => pick(null)} busy={busy === 'auto'} data-testid="truck-auto">{t('jobs.truck.auto')}</Button>}
      </div>
    </Sheet>
  );
}
