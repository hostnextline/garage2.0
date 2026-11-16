/* « La voiture ferme » (Horaires → « Appliquer » when the new hours close a day or a block that has appointments, and the
   garage has a vehicle of the other kind): every appointment touched, the other vehicle's route that day with them in it
   (the phone's copy, streets from the route planner), and the choice: move them, close without moving (they go to
   « À placer »), or cancel. Never a vehicle's or a mechanic's name: « la voiture », « le camion ».
   While the moves and the hours are on their way the sheet stays open and its buttons wait (busy): a refused move leaves
   it open with what is left to decide. */
import { useMemo, useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { duration, longDay } from '../../lib/dates';
import { customer as customerRow, customerName, staffName, truck as truckRow } from '../../data/select';
import { Sheet, Button, Banner, Chips, Pill } from '../../ui';
import { MapView } from '../../shared/map/MapView';
import { assemble } from '../../shared/map/assemble';
import { routeLayers } from '../../shared/map/layers';
import { fmtKm } from '../../shared/map/distance';
import { fromDevice } from '../../shared/map/device';
import { useRoads, roadOf, roadTotal } from '../../shared/map/useRoads';
import { moveStops } from '../../shared/moment/preview';
import type { Move } from '../../shared/map/closing';
import { momentWord } from '../../shared/jobs/select';

const kindWord = (truckId: string | null, form: 'of' | 'to') => t(`hours.closing.${form}.${truckRow(truckId)?.tire_machine === false ? 'car' : 'truck'}`);

export function CloseDaySheet(p: { truckId: string; moves: Move[]; busy?: boolean; onMove: () => Promise<unknown>; onJustClose: () => Promise<unknown>; onClose: () => void }) {
  const l = lang.value;
  const days = [...new Set(p.moves.map((m) => m.job.day))];
  const [picked, setDay] = useState(days[0]);
  // the list can shrink (a move refused after others went): the day shown is always one of the list
  const day = days.includes(picked) ? picked : days[0];
  const going = p.moves.filter((m) => m.target);
  const staying = p.moves.length - going.length;
  const target = going.find((m) => m.job.day === day)?.target || going[0]?.target || null;
  const route = useMemo(() => {
    if (!target) return null;
    const ids = going.filter((m) => m.job.day === day && m.target === target).map((m) => m.job.id);
    return assemble(moveStops(fromDevice(day), ids, target), { nameOf: staffName }).trucks.find((x) => x.id === target) || null;
  }, [day, target, p.moves]);
  useRoads(route ? [route] : []);
  const road = route ? roadTotal(route) : null;
  const { markers, lines } = route ? routeLayers(route, { marked: new Set(going.map((m) => m.job.id)), startLabel: t('booking.preview.start'), road: roadOf }) : { markers: [], lines: [] };
  const from = kindWord(p.truckId, 'of');
  const to = kindWord(target, 'to');
  return (
    <Sheet open onClose={p.onClose} title={t('hours.closing.title', { n: p.moves.length })} sub={t('hours.closing.sub', { from })} data-testid="close-day-sheet"
      footer={<>
        <Button onClick={p.onClose} disabled={p.busy}>{t('common.cancel')}</Button>
        <Button onClick={p.onJustClose} disabled={p.busy} data-testid="close-day-only">{t('hours.closing.only')}</Button>
        {going.length > 0 && <Button variant="primary" onClick={p.onMove} disabled={p.busy} data-testid="close-day-move">{t('hours.closing.move', { n: going.length, to })}</Button>}
      </>}>
      <div class="stack">
        <Banner kind={going.length ? 'info' : 'warn'} data-testid="close-day-ask">
          {going.length ? t('hours.closing.ask', { n: going.length, to }) : t('hours.closing.none')}
          {going.length > 0 && staying > 0 ? ` ${t('hours.closing.someStay', { n: staying })}` : ''}
        </Banner>
        <ul class="hours-closing-list" data-testid="close-day-list">
          {days.map((d) => (
            <li key={d}>
              <b>{longDay(d, l)}</b>
              <ul>
                {p.moves.filter((m) => m.job.day === d).map((m) => (
                  <li key={m.job.id} data-testid="close-day-job">
                    <span>{[m.job.number ? `#${m.job.number}` : '', customerName(customerRow(m.job.customer_id)), momentWord(m.job), m.job.address || customerRow(m.job.customer_id)?.address || ''].filter(Boolean).join(', ')}</span>
                    {m.target ? <Pill tone="ok" dot={false}>{t('hours.closing.goes', { to: kindWord(m.target, 'to') })}</Pill>
                      : <Pill tone="warn" dot={false}>{t(`hours.closing.stays.${m.why || 'closed'}`)}</Pill>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {going.length > 0 && (
          <>
            <h3 class="hours-closing-h">{t('hours.closing.mapTitle', { to: kindWord(target, 'of') })}</h3>
            {days.length > 1 && <Chips label={t('hours.closing.day')} value={[day]} onValue={(v) => { if (v[0]) setDay(v[0]); }} options={days.map((d) => ({ value: d, label: longDay(d, l) }))} data-testid="close-day-days" />}
            <MapView markers={markers} lines={lines} height="300px" label={t('hours.closing.mapTitle', { to: kindWord(target, 'of') })} data-testid="close-day-map" />
            {route && <p class="small" style={{ margin: 0 }} data-testid="close-day-facts">
              {t('hours.closing.stops', { n: route.total })}{road ? ` ${t('hours.closing.road', { km: fmtKm(road.km, l), d: duration(road.minutes, l) })}` : ''}
            </p>}
            <p class="faint small" style={{ margin: 0 }}>{t('booking.preview.note')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
