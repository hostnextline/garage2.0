/* « Changer de camion »: the same day and block (or arrival window), another truck (booked by mistake on the wrong one).
   No text to the customer: the day and the hours do not change (unless the server says they did: `tell`, R84; then the
   question « Texter … ? », shared/jobs/textAsk: nothing goes by itself; none asked, the toast of the day he was told
   when that day is today and the move changed it: Part 28, toldDayAfter).
   Each truck says how much room it has. Switch « Vraies routes » OFF, as before: its free time in that block from the
   phone's copy (blockLoad: the hours less the jobs and the server's drive times, a drive not timed yet counted
   unknown_min), « Peut-être trop juste » when that is less than the job. Switch ON that number is a guess (the job left
   out keeps the drive that went through it, the drive to the job is not in it, a stop not timed counts a fixed time), so
   it is not shown: the server says, for each other truck, whether it can take the appointment and its arrival there, or
   why not (move_preview with only it, the very move the tap sends: asTold), or « Place : pas encore calculée ».
   « exact move » (STATE.md A1): with arrival windows, the appointment KEEPS ITS TIME on the other truck (its minute pointed
   by hand, else its arrival when that arrival gives the very window the customer has: keptTimeOf). The tap then goes
   through the one flow (exactMove: the preview of that minute on that truck, a question only when somebody would be
   later / late or the truck cannot be there then, never kept on the phone) and, switch on, each truck says it from the
   exact preview of that minute. « Laisser l'app choisir », blocks, flexible: as before (the 5-argument move). */
import { useState } from 'preact/hooks';
import { Truck } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Sheet, Button, Rows, RowItem, Pill, toast } from '../../ui';
import { t, lang } from '../../lib/i18n';
import { codeWords } from '../../lib/errors';
import { clock, duration } from '../../lib/dates';
import { truckLabel, truckColor, blockLoad, settings, job as jobRow, roadsOn, windowsOn, windowOf } from '../../data/select';
import { moveJob, errorMessage } from '../../data/api';
import { freeWords } from '../../domain/moment/words';
import { moveTextGoes } from '../../domain/jobs/move';
import { keptTimeOf } from '../../domain/jobs/exact';
import { moveAt, doneWords } from '../../shared/jobs/exactMove';
import { dayInSentence, momentWord, wt, etaUnsure } from '../../shared/jobs/select';
import { askMovedText, toldDayAfter } from '../../shared/jobs/textAsk';
import { useTruckFits, type Fit } from './previews';

/** switch on: what the server said of one truck (never a free time worked out by the phone). An arrival only when every
    trip of that day is measured (review-sheets M1). A refusal is said with the words of its code (move_preview's
    refused_why = move_job's refusal: truck_full, block_started…, words of src/i18n errors); tire work refused by the car
    in the sheet's short words (the phone knows that rule exactly: the server's needs_truck); no code, or one with no words:
    the general words */
function fitWords(f: Fit | undefined, l: string, carForMachine: boolean, kept: number | null): string {
  if (!f || f.kind === 'off' || f.kind === 'asking') return t('jobs.truck.asking');
  if (f.kind === 'none') return t('jobs.truck.unknown');
  if (!f.answer.fits) {
    if (carForMachine || f.answer.why === 'needs_truck') return t('jobs.truck.needsTruck');
    // the time kept: that truck cannot be there then (« exact move »)
    if (kept != null && f.answer.why === 'arrive_late') {
      return f.answer.earliest != null ? t('jobs.truck.notAt', { time: clock(kept, l), earliest: clock(f.answer.earliest, l) }) : t('jobs.truck.notAtNoTime', { time: clock(kept, l) });
    }
    return (f.answer.why && codeWords(f.answer.why, 'move_job')) || t('jobs.truck.noRoom');
  }
  if (kept != null && f.answer.eta != null) return f.answer.late ? t('jobs.truck.keepsLate', { time: clock(f.answer.eta, l), n: f.answer.late }) : t('jobs.truck.keeps', { time: clock(f.answer.eta, l) });
  if (f.answer.eta != null) return t('jobs.truck.fits', { time: clock(f.answer.eta, l) });
  return f.answer.unmeasured ? t('jobs.truck.fitsUnmeasured') : t('jobs.truck.fitsNoTime');
}

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
  const on = roadsOn.value;
  // switch on: the server's word for every other truck that works then
  // « exact move »: the time the appointment keeps on the other truck (null: the move of before)
  const kept = windowsOn.value ? keptTimeOf(j, windowOf) : null;
  const fits = useTruckFits(on, j, working.filter((x) => x.cap > 0 && x.truck.id !== j.truck_id).map((x) => x.truck.id), kept);
  // the truck being sent (or 'auto'): the rows take no second tap meanwhile
  const [busy, setBusy] = useState<string | null>(null);
  /** to that truck at the very time it has (A1): the flow asks only what there is to hear; « Choisir une autre heure » keeps
      the sheet open */
  const pickKeeping = async (truckId: string, at: number) => {
    const d = await moveAt({ job: j, day: j.day, truck: truckId, at, confirm: false });
    if (d.kind === 'stopped') return;
    if (d.kind === 'refused') { toast(errorMessage(d.error), { kind: 'bad' }); return; }
    const r = { queued: false, data: d.r.data };
    const unchanged = !!(d.r.data as { unchanged?: boolean } | undefined)?.unchanged;
    if (unchanged) toast(t('jobs.truck.same'));
    // « Mettre à … » changed the time (the truck could not be there at the one it had): said, never « toujours à » (review F5)
    else toast(doneWords(d, j.day, d.at === at ? t('jobs.truck.doneKept', { truck: truckLabel(truckId), time: clock(d.at, l) })
      : t('jobs.truck.doneAt', { truck: truckLabel(truckId), time: clock(d.at, l), was: clock(at, l) })), { kind: 'ok', ...(d.late.length || d.at !== at ? { ms: 8000 } : {}) });
    p.onClose();
    if (!(moveTextGoes(r, j, jobRow(j.id), !!settings.value.messages?.on?.moved) && askMovedText(j, { via: 'jobs' })) && !unchanged) toldDayAfter(j);
  };
  const pick = async (truckId: string | null) => {
    setBusy(truckId || 'auto');
    if (truckId && kept != null) {
      try { await pickKeeping(truckId, kept); } finally { setBusy(null); }
      return;
    }
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
      // of the other mode converted, its window cut again: `tell`) is « Texter … ? » asked, as from « Déplacer » (R84)
      const asked = moveTextGoes(r, j, jobRow(j.id), !!settings.value.messages?.on?.moved) && askMovedText(j, { via: 'jobs' });
      if (!asked && !r.queued && !d?.unchanged) toldDayAfter(j);
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
              const room = x.cap - x.used >= j.duration_min;
              return (
                <RowItem key={x.truck.id} data-testid={`truck-pick-${x.truck.id}`}
                  start={<span class="jobs-truck-dot" style={{ '--tc': truckColor(x.truck.id) }} aria-hidden="true"><Truck size={18} /></span>}
                  title={<>{truckLabel(x.truck.id)}{mine && <Pill tone="booked">{t('jobs.truck.current')}</Pill>}</>}
                  sub={x.cap <= 0 ? wt(j, 'jobs.truck.off')
                    : !on ? `${freeWords(x.used, x.cap, l)}${room || mine ? '' : `. ${t('jobs.truck.tight', { d: duration(j.duration_min, l) })}`}`
                      : mine ? (j.status !== 'booked' ? undefined : etaUnsure(j) ? t('jobs.truck.nowUnmeasured')
                        : j.eta_min != null ? t('jobs.truck.nowEta', { time: clock(j.eta_min, l) }) : undefined)
                        : fitWords(fits[x.truck.id], l, !!j.needs_machine && x.truck.tire_machine === false, kept)}
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
