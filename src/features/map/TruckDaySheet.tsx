/* « Départ et heure » of a truck, from the map's legend: where it leaves from (« Départ de ce camion », the same panel as
   Horaires) and when it starts on the day shown (that day only: Horaires keeps the usual week). A new start time keeps the
   end of the day; the server plans the day again (apply_hours, mode day).
   Before saving, the appointments the new hours leave out are counted and the person is asked, as Horaires does; the
   answer of the server says what really happened (nothing written for that day: « Rien n'a changé »). */
import { useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { clock, dow, longDay, today } from '../../lib/dates';
import { truck as truckRow, truckRanges, allJobs, blockOfKey, customer as customerRow } from '../../data/select';
import { can, isOwner, myTrucks } from '../../data/auth';
import { applyHours } from '../../data/api';
import { flush, pull } from '../../data/sync';
import { Sheet, Panel, Field, Select, Button, ask, run, toast } from '../../ui';
import { TruckStartPanel } from '../../shared/places/TruckStartPanel';
import { rangesWords, listWords } from '../../domain/moment/words';
import { closedJobs, holdsJobsOf } from '../../shared/map/closing';
import { withStart, startTimes } from './truckDay';

export function TruckDaySheet(p: { truckId: string; day: string; onClose: () => void }) {
  const tr = truckRow(p.truckId);
  const l = lang.value;
  const rs = truckRanges(p.truckId, p.day);
  const now = rs[0]?.[0] ?? null;
  const [start, setStart] = useState<string>(now != null ? String(now) : '480');
  // the start sent and kept on the phone (no signal): the button waits for the answer or a new choice
  const [sent, setSent] = useState<string | null>(null);
  if (!tr) return null;
  const next = withStart(rs, Number(start));
  const gone = p.day < today();
  const changed = !gone && (now == null || Number(start) !== now) && start !== sent;
  const blind = !holdsJobsOf(p.truckId, { owner: isOwner(), agenda: can('agenda'), mine: myTrucks() });

  const save = async () => {
    const out = closedJobs(allJobs.value, p.truckId, { [dow(p.day)]: next }, [p.day], blockOfKey);
    if (out.length) {
      const who = listWords(out.map((j) => (customerRow(j.customer_id)?.first_name || '').trim() || `#${j.number}`), l);
      if (!(await ask({ title: t('map.truckDay.askTitle', { n: out.length }), text: t('map.truckDay.askText', { who }), ok: t('map.truckDay.askOk'), danger: true }))) return;
    }
    const r = await run(() => applyHours(p.truckId, 'day', { [dow(p.day)]: next }, p.day));
    if (!r) return;                                   // refused: the reason is in the toast
    if (r.queued) { setSent(start); return; }         // « gardé sur le téléphone » is in the toast
    if ((r.data as { changed?: number } | undefined)?.changed === 0) { toast(t('map.truckDay.nothing')); return; }
    toast(t('map.truckDay.saved', { time: clock(Number(start), l) }), { kind: 'ok' });
    // the day was planned again on the server: bring the hours and the appointments now
    await run(() => flush().then(() => Promise.all([pull('truck_days'), pull('jobs')])), { quiet: true });
  };
  return (
    <Sheet open onClose={p.onClose} title={t('map.truckDay.title', { name: tr.name })} sub={longDay(p.day, l)} data-testid="truck-day-sheet"
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="stack">
        <Panel title={t('map.truckDay.timeTitle')} sub={t('map.truckDay.timeSub')} data-testid="truck-day-time">
          <div class="stack">
            <p class="small muted" style={{ margin: 0 }}>{rs.length ? t('map.truckDay.now', { hours: rangesWords(rs, l) }) : t('map.truckDay.off')}</p>
            <Field label={t('map.truckDay.start')}>
              <Select value={start} onValue={setStart} options={startTimes(now).map((m) => ({ value: String(m), label: clock(m, l) }))} aria-label={t('map.truckDay.start')} disabled={gone} />
            </Field>
            {changed && <p class="small" style={{ margin: 0 }} data-testid="truck-day-after">{t('map.truckDay.after', { hours: rangesWords(next, l) })}</p>}
            {changed && blind && <p class="small muted" style={{ margin: 0 }}>{t('map.truckDay.blind')}</p>}
            <div><Button variant="primary" disabled={!changed} onClick={save} data-testid="truck-day-save">{t('map.truckDay.save')}</Button></div>
          </div>
        </Panel>
        <TruckStartPanel truckId={p.truckId} canEdit />
      </div>
    </Sheet>
  );
}
