/* « Voir sur la carte » (a right-click or a long press on a moment offered, or the button under the moment chosen): the
   vehicle's day by the streets with the new appointment, and what is said under it.
   - « Vraies routes » OFF: the phone's estimate of where the new stop goes (preview.ts placeNewStop: the place and the
     number only), the day's road by the streets and what the stop adds by the streets (roadAdded: only when ONE planner
     measured both totals); not known → « Route ajoutée : pas encore calculée ».
   - ON: the server's row (placeOn): its vehicle, the place and the order (window mode), what it adds and the day with it
     in real driving time; nothing known → the day as it is, the new stop as a pin without a number, plain words.
   The roads are asked for the day shown; nothing is drawn between two stops before a real road comes, and the words under
   the map say so (map.roadNote). Never a straight-line distance (Hassan's rule, 2026-11-19). */
import { useMemo } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { t, lang } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { Sheet, Button, Banner } from '../../ui';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, UNPLACED_COLOR, type TruckRoute } from '../map/assemble';
import { useRoads, roadOf, roadTotal, roadAdded } from '../map/useRoads';
import { roadNote } from './roadNote';
import { staffName, activeTrucks, roadsOn } from '../../data/select';
import { addsFromRow, dayFromRow, rowOfTruck } from '../../domain/moment/serverPlace';
import { placeNewStop, placeOn, fmtKm, NEW_STOP, NEW_STOP_COLOR, type Spot } from './preview';
import { dayOf } from './deviceDay';
import { floatStyle, hoverBox, HOVER_W, type FloatAt, type Rect } from './place';
import { bothKinds, kindOf } from './vehicles';

export interface PreviewAsk extends Spot { when: string; exclude?: string | null }

/** the words beside a map whose roads are not all drawn (its own module; said here as before) */
export { roadNote };

/** what is said of a row, as a key that changes only when it does (the screens make a new ask at each drawing) */
const rowSig = (a: Spot) => (a.row ? [a.row.truck, a.row.rank, (a.row.route || []).join(','), a.row.stops].join('|') : '');

/** the day of the vehicle with the new stop in it: what the map draws and what is said under it */
function useRouteDay(a: PreviewAsk, all = false) {
  const l = lang.value;
  const on = roadsOn.value;
  const day = a.day;
  const placed = useMemo(() => {
    const d = dayOf(a.day, a.exclude);
    if (on) return placeOn(d, a);
    const p = placeNewStop(d, a);
    return { before: p.before, after: p.after, truckId: p.truckId, rank: null };
  }, [on, a.day, a.block, a.truckId, a.lat, a.lng, a.exclude, a.eta, rowSig(a)]);
  const after = useMemo(() => assemble(placed.after, { nameOf: staffName }), [placed]);
  const before = useMemo(() => assemble(placed.before, { nameOf: staffName }), [placed]);
  const trA: TruckRoute | undefined = placed.truckId ? after.trucks.find((x) => x.id === placed.truckId) : undefined;
  const trB: TruckRoute | undefined = placed.truckId ? before.trucks.find((x) => x.id === placed.truckId) : undefined;
  const busy = after.trucks.filter((x) => x.stops.length);
  /* the routes drawn: every vehicle working that day (the small window), else the one the appointment goes on; switch
     on with no vehicle chosen yet: the day as it is */
  const drawn = all ? busy : trA ? [trA] : on ? busy : [];
  // off: the day without the stop too, for what it adds (the same planner for both, roadAdded)
  useRoads(on ? drawn : [...drawn, ...(trB && trB.stops.some((s) => s.hasPos) ? [trB] : [])], day);
  const roadA = trA ? roadTotal(trA, day) : null;
  const mine = trA?.stops.find((s) => s.id === NEW_STOP);

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const newMk = (n: number | string): MapMarker => ({ id: NEW_STOP, kind: 'job', lat: a.lat, lng: a.lng, color: NEW_STOP_COLOR, number: n, active: true,
    label: t('booking.preview.newLabel'), sub: a.when, title: t('booking.preview.newLabel') });
  /* switch on with the server's order: each stop keeps its place in the server's route; a stop the route does not name
     has no number (never above « sur N », review-moments L2) */
  const numberOf = (s: TruckRoute['stops'][number]): number | string => (on && placed.rank ? s.order ?? '' : s.n);
  let homeDrawn = false;
  for (const tr of drawn) {
    if (!tr.stops.length) continue;
    const own = tr.id === placed.truckId;
    if (tr.from && tr.start) markers.push({ id: `from-${tr.id}`, kind: 'customer', lat: tr.from[0], lng: tr.from[1], color: tr.color, label: tr.start.label || t('booking.preview.start'), title: tr.start.address || '' });
    else if (tr.from && !homeDrawn) { homeDrawn = true; markers.push({ id: 'from', kind: 'home', lat: tr.from[0], lng: tr.from[1], label: after.home?.label || t('booking.preview.start'), title: after.home?.address || '' }); }
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      if (s.id === NEW_STOP) markers.push(newMk(on && placed.rank ? placed.rank.n : s.n));
      else { const n = numberOf(s); markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: n, done: s.done, title: n === '' ? s.name : `${n}. ${s.name}` }); }
    }
    // the other vehicles' routes are drawn lighter: the eye goes to the route the appointment joins
    for (const leg of tr.legs) lines.push({ points: roadOf(leg, day), color: tr.color, weight: own ? 4 : 3, opacity: leg.kind === 'done' ? 0.32 : own ? 0.85 : 0.6 });
  }
  if (all) for (const s of after.unplaced) if (s.hasPos && s.id !== NEW_STOP) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '', title: s.name });
  // the new stop outside any route: switch on, its place is not known (no number); off, alone that day (« 1 »)
  if (!markers.some((m) => m.id === NEW_STOP)) markers.push(newMk(on ? '' : '1'));

  // the route is the car's or the truck's: no vehicle or mechanic name
  const trucks = activeTrucks.value;
  const both = bothKinds(trucks);
  const truckName = both ? t(kindOf(trucks, placed.truckId) === 'car' ? 'booking.kind.ofCar' : 'booking.kind.ofTruck') : t('booking.kind.ofRoute');
  const note = roadNote(drawn.filter((tr) => tr.stops.some((s) => s.hasPos)), day);

  /* what is said */
  let stop = '', dayLine = '', adds = '', alone = false;
  if (on) {
    if (placed.rank) stop = t('booking.preview.stop', { n: placed.rank.n, total: placed.rank.total, truck: truckName });
    // the vehicle is known, not the place (blocks mode): which route, and that its place is chosen at the booking
    else if (placed.truckId) stop = t('booking.preview.stopLater', { truck: truckName });
    else if (!after.trucks.length) alone = true;
    else stop = t(both ? 'booking.preview.noVehicleYet' : 'booking.preview.noTruckYet');
    // the row's numbers only under its own vehicle's map (review-moments L1)
    const row = rowOfTruck(a.row, placed.truckId || a.truckId);
    dayLine = dayFromRow(row, l);
    adds = addsFromRow(row, l);
  } else if (trA && mine) {
    stop = t('booking.preview.stop', { n: mine.n, total: trA.total, truck: truckName });
    dayLine = roadA ? t('booking.preview.day', { km: fmtKm(roadA.km, l), d: duration(roadA.minutes, l) }) : '';
    // what it adds by the streets: only from two totals of the same planner for that day, else nothing guessed
    const added = roadAdded(trA, trB, day);
    adds = added ? t('booking.preview.addsRoad', { km: fmtKm(added.km, l), d: duration(added.minutes, l) }) : t('booking.preview.addsUnknown');
  } else alone = true;
  return { markers, lines, stop, dayLine, adds, alone, note, on };
}

/** « Voir sur la carte » in a sheet (`onPick`: « Choisir ce moment », only for a moment that can be chosen), or with
    `float` the small window beside a moment hovered with a mouse (no buttons, nothing to close: it follows the pointer) */
export function RoutePreview(p: { ask: PreviewAsk; onClose?: () => void; onPick?: () => void; float?: FloatAt }) {
  const a = p.ask;
  const { markers, lines, stop, dayLine, adds, alone, note, on } = useRouteDay(a);
  if (p.float) {
    // drawn on the page itself: inside a glass panel a fixed box is cut by the panel
    return createPortal(
      <div class="bp-hover-map" style={floatStyle(p.float)} role="tooltip" data-testid="route-hover">
        <p class="bp-hover-when">{p.float.title || a.when}</p>
        <MapView markers={markers} lines={lines} height="220px" controls={false} label={t('booking.preview.mapLabel')} data-testid="route-hover-map" />
        {!alone ? (
          <p class="bp-hover-facts" data-testid="route-hover-facts">
            {stop && <><b>{stop}</b>{' '}</>}{adds}{note ? ` · ${note}` : ''}
          </p>
        ) : <p class="bp-hover-facts">{t('booking.preview.noTruck')}</p>}
      </div>, document.body);
  }
  const close = () => p.onClose?.();
  return (
    <Sheet open onClose={close} title={t('booking.preview.title')} sub={a.when} data-testid="route-preview"
      footer={<>
        <Button onClick={close}>{t('common.close')}</Button>
        {p.onPick && <Button variant="primary" onClick={() => { p.onPick!(); close(); }} data-testid="route-preview-pick">{t('booking.preview.pick')}</Button>}
      </>}>
      <div class="stack">
        <MapView markers={markers} lines={lines} height="320px" label={t('booking.preview.mapLabel')} data-testid="route-preview-map" />
        {note && <p class="faint small" style={{ margin: 0 }} data-testid="route-preview-road">{note}</p>}
        {!alone ? (
          <ul class="bp-preview-facts" data-testid="route-preview-facts">
            {stop && <li><b>{stop}</b></li>}
            {dayLine && <li data-testid="route-preview-day">{dayLine}</li>}
            <li data-testid="route-preview-extra">{adds}</li>
          </ul>
        ) : <Banner kind="info">{t('booking.preview.noTruck')}</Banner>}
        <p class="faint small" style={{ margin: 0 }}>{t(on ? 'booking.preview.noteRoads' : 'booking.preview.note')}</p>
      </div>
    </Sheet>
  );
}

/** the same map in a small window beside the moment the mouse is over (computers only): no scrolling to the big map.
    `at` is the moment's box on screen; the window never takes the mouse (a click still chooses the moment). */
export function MapHover(p: { at: Rect; title: string; markers: MapMarker[]; lines?: MapLine[]; facts?: string; far?: boolean; 'data-testid'?: string }) {
  const { left, top } = hoverBox(p.at, window.innerWidth, window.innerHeight);
  return createPortal(
    <div class="bp-hover" style={{ left: `${left}px`, top: `${top}px`, width: `${HOVER_W}px` }} aria-hidden="true" data-testid={p['data-testid'] || 'route-hover'}>
      <b class="bp-hover-when">{p.title}</b>
      <MapView markers={p.markers} lines={p.lines || []} height="220px" controls={false} fitPadding={[28, 28, 28, 28]} data-testid="route-hover-map" />
      <span class="bp-hover-key"><i />{t('booking.preview.newLabel')}</span>
      {p.facts && <span class="bp-hover-facts">{p.facts}</span>}
      {p.far && <span class="bp-hover-far">{t('booking.far.legend')}</span>}
    </div>, document.body);
}

export function RouteHover(p: { ask: PreviewAsk; at: Rect; road?: string; far?: boolean }) {
  const { markers, lines, stop, alone, note } = useRouteDay(p.ask, true);
  const facts = [alone ? t('booking.preview.noTruck') : stop, p.road, note].filter(Boolean).join(' · ');
  return <MapHover at={p.at} title={p.ask.when} markers={markers} lines={lines} facts={facts} far={p.far} />;
}
