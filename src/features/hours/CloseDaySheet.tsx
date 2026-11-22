/* « La voiture ferme » (Horaires → « Appliquer » when the new hours close a day or a block that has appointments, and the
   garage has a vehicle of the other kind): every appointment touched, the other vehicle's route that day with them in it,
   and the choice: move them, close without moving (they go to « À placer »), or cancel. Never a vehicle's or a mechanic's
   name: « la voiture », « le camion ».
   The route shown: switch « Vraies routes » OFF, the phone's copy with each moved appointment at its cheapest place
   (moveStops), as before. Switch ON, the server's answer (move_preview: the very move_job, undone): its order, its numbers,
   its « Route de la journée »; while it is asked or when it does not answer, the day as it is and the moved appointments
   as pins without numbers (« Ordre et route : pas encore calculés »), never the phone's guess (closeRoute.ts); a day of
   the list where nothing goes to that vehicle is asked too (an empty list: the server's day as it is). An arrival time is
   said only when the answer says every trip of that day is measured (else « heure : trajets pas encore mesurés »). The lines are
   the streets of THAT day (useRoads), nothing drawn until a real road comes, and the note says why.
   While the moves and the hours are on their way the sheet stays open and its buttons wait (busy): a refused move leaves
   it open with what is left to decide. */
import { useMemo, useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { codeWords } from '../../lib/errors';
import { clock, duration, longDay } from '../../lib/dates';
import { customer as customerRow, customerName, staffName, truck as truckRow, roadsOn } from '../../data/select';
import { Sheet, Button, Banner, Chips, Pill } from '../../ui';
import { MapView } from '../../shared/map/MapView';
import { assemble } from '../../shared/map/assemble';
import { routeLayers } from '../../shared/map/layers';
import { fmtKm } from '../../shared/map/distance';
import { fromDevice } from '../../shared/map/device';
import { useRoads, roadOf, roadTotal, roadState, type RoadState } from '../../shared/map/useRoads';
import type { MapMarker } from '../../shared/map/markers';
import { moveStops } from '../../shared/moment/preview';
import type { Move } from '../../shared/map/closing';
import { momentWord } from '../../shared/jobs/select';
import { timesMeasured } from '../../domain/jobs/move';
import { useMovePreview, serverDay, dayAsItIs, movedPins, startOf } from './closeRoute';

const kindWord = (truckId: string | null, form: 'of' | 'to') => t(`hours.closing.${form}.${truckRow(truckId)?.tire_machine === false ? 'car' : 'truck'}`);
/** the words under the map while its line is not drawn (the same as the map legend's) */
const ROAD_NOTE: Partial<Record<RoadState, string>> = { asking: 'map.roadNote.asking', down: 'map.roadNote.none', never: 'map.roadNote.never' };

export function CloseDaySheet(p: { truckId: string; moves: Move[]; busy?: boolean; onMove: () => Promise<unknown>; onJustClose: () => Promise<unknown>; onClose: () => void }) {
  const l = lang.value;
  const on = roadsOn.value;
  const days = [...new Set(p.moves.map((m) => m.job.day))];
  const [picked, setDay] = useState(days[0]);
  // the list can shrink (a move refused after others went): the day shown is always one of the list
  const day = days.includes(picked) ? picked : days[0];
  const going = p.moves.filter((m) => m.target);
  const staying = p.moves.length - going.length;
  const target = going.find((m) => m.job.day === day)?.target || going[0]?.target || null;
  const ids = useMemo(() => going.filter((m) => m.job.day === day && m.target === target).map((m) => m.job.id), [day, target, p.moves]);
  // switch on: what the server would do with these moves (nothing written); an empty list too (the day as it is)
  const asked = useMovePreview(on, target, day, ids);
  const answer = asked.kind === 'done' ? asked.answer : null;
  const view = useMemo(() => {
    if (!target) return { route: null, pins: [] as MapMarker[], start: null };
    const a = fromDevice(day);
    const pick = (x: typeof a) => assemble(x, { nameOf: staffName }).trucks.find((tr) => tr.id === target) || null;
    if (!on) return { route: pick(moveStops(a, ids, target)), pins: [] as MapMarker[], start: null };
    if (answer) return { route: pick(serverDay(a, target, answer)), pins: [] as MapMarker[], start: null };
    return { route: pick(dayAsItIs(a, ids)), pins: movedPins(a, ids), start: startOf(a, target) };
  }, [day, target, p.moves, on, answer]);
  const route = view.route;
  useRoads(route ? [route] : [], day);
  const road = route ? roadTotal(route, day) : null;
  const note = route ? ROAD_NOTE[roadState(route, day)] : undefined;
  const layers = route ? routeLayers(route, { marked: new Set(ids), startLabel: t('booking.preview.start'), road: (leg) => roadOf(leg, day) }) : { markers: [], lines: [] };
  // a day where the vehicle has no stop yet, the moves not placed yet: its start alone, with the pins
  const startPin: MapMarker[] = !route && view.start ? [{ id: 'from', kind: view.start.own ? 'customer' : 'home', lat: view.start.lat, lng: view.start.lng, label: view.start.label || t('booking.preview.start') }] : [];
  const markers = [...layers.markers, ...startPin, ...view.pins];
  const refused = new Set(answer ? answer.refused.filter((id) => ids.includes(id)) : []);
  const from = kindWord(p.truckId, 'of');
  const to = kindWord(target, 'to');
  /* the facts under the map. Off: the phone's route and its streets, as before. On: the server's count and its
     « Route de la journée » (never a number while a trip of that day is not measured); not answered: only the count, and
     « pas encore calculés » only when something moves there that day (else the day as it is IS the answer) */
  const facts = (() => {
    if (!on) return route ? [t('hours.closing.stops', { n: route.total }), road ? t('hours.closing.road', { km: fmtKm(road.km, l), d: duration(road.minutes, l) }) : ''] : null;
    if (answer) {
      const unm = answer.unmeasured ?? 0;
      const said = answer.day_km != null && answer.day_min != null && unm === 0 ? t('hours.closing.road', { km: fmtKm(answer.day_km, l), d: duration(answer.day_min, l) })
        : unm > 0 ? t('hours.closing.roadUnmeasured', { n: unm }) : '';
      return [t('hours.closing.stops', { n: answer.order.length }), said, refused.size ? t('hours.closing.refusedSome', { n: refused.size }) : ''];
    }
    return [t('hours.closing.stops', { n: (route?.total ?? 0) + ids.length }), ids.length ? t('hours.closing.pending') : ''];
  })();
  /** a moved appointment's place in the server's route (on, answered, the day shown). Its arrival only when every trip of
      that day is measured: a trip not measured counts a fixed time on the server (review-sheets M1) */
  const placeOf = (id: string) => {
    if (!answer || refused.has(id)) return '';
    const s = route?.stops.find((x) => x.id === id);
    if (!s) return '';
    if ((answer.unmeasured ?? 0) > 0) return t('hours.closing.atUnmeasured', { n: s.n });
    const eta = timesMeasured(answer) ? answer.eta[id] : null;
    return eta != null ? t('hours.closing.at', { n: s.n, time: clock(eta, l) }) : t('hours.closing.atNoTime', { n: s.n });
  };
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
                {p.moves.filter((m) => m.job.day === d).map((m) => {
                  const place = d === day ? placeOf(m.job.id) : '';
                  // why the server refuses it, in the words of move_job's refusal code (none: the pill alone)
                  const why = d === day && refused.has(m.job.id) ? answer?.refused_why?.[m.job.id] : undefined;
                  const whyWords = why ? codeWords(why, 'move_job') : undefined;
                  return (
                    <li key={m.job.id} data-testid="close-day-job">
                      <span>{[m.job.number ? `#${m.job.number}` : '', customerName(customerRow(m.job.customer_id)), momentWord(m.job), m.job.address || customerRow(m.job.customer_id)?.address || ''].filter(Boolean).join(', ')}</span>
                      {!m.target ? <Pill tone="warn" dot={false}>{t(`hours.closing.stays.${m.why || 'closed'}`)}</Pill>
                        : d === day && refused.has(m.job.id) ? <Pill tone="warn" dot={false} data-testid="close-day-refused">{t('hours.closing.refusedHere', { to: kindWord(m.target, 'to') })}</Pill>
                          : <Pill tone="ok" dot={false}>{t('hours.closing.goes', { to: kindWord(m.target, 'to') })}</Pill>}
                      {place && <span class="small muted hours-closing-place" data-testid="close-day-place"> {place}</span>}
                      {whyWords && <span class="small muted hours-closing-place" data-testid="close-day-why">{whyWords}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {going.length > 0 && (
          <>
            <h3 class="hours-closing-h">{t('hours.closing.mapTitle', { to: kindWord(target, 'of') })}</h3>
            {days.length > 1 && <Chips label={t('hours.closing.day')} value={[day]} onValue={(v) => { if (v[0]) setDay(v[0]); }} options={days.map((d) => ({ value: d, label: longDay(d, l) }))} data-testid="close-day-days" />}
            <MapView markers={markers} lines={layers.lines} height="300px" label={t('hours.closing.mapTitle', { to: kindWord(target, 'of') })} data-testid="close-day-map" />
            {facts && <p class="small" style={{ margin: 0 }} data-testid="close-day-facts">{facts.filter(Boolean).join(' ')}</p>}
            {note && <p class="faint small" style={{ margin: 0 }} data-testid="close-day-road-note">{t(note)}</p>}
            {!on ? <p class="faint small" style={{ margin: 0 }}>{t('booking.preview.note')}</p>
              : answer ? <p class="faint small" style={{ margin: 0 }} data-testid="close-day-server">{t('hours.closing.serverNote')}</p> : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
