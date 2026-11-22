/* The day on the map with the new appointment in it, two ways:
   - « Voir sur la carte » (a right-click or a long press on a moment offered, or the button under the moment chosen): a
     sheet, with « Choisir ce moment »;
   - on a computer, the mouse resting on a moment (a best moment, a time of the calendar, a block): the same map in a
     window beside the picker (RouteHover). It is the real map of that day, big enough to read: every vehicle's route by
     the streets, its numbered stops, the new appointment in black, and under it the stops of the route it joins.
   What is said under the map:
   - « Vraies routes » OFF: the phone's estimate of where the new stop goes (preview.ts placeNewStop: the place and the
     number only), the day's road by the streets and what the stop adds by the streets (roadAdded: only when ONE planner
     measured both totals); not known → « Route ajoutée : pas encore calculée ».
   - ON: the server's row (placeOn): its vehicle, the place and the order (window mode), what it adds and the day with it
     in real driving time; nothing known → the day as it is, the new stop as a pin without a number, plain words.
   The roads are asked for the day shown; nothing is drawn between two stops before a real road comes, and the words under
   the map say so (map.roadNote). Never a straight-line distance (Hassan's rule, 2026-11-19). */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
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
import { popPlace, POP, type Rect } from './place';
import { bothKinds, kindOf } from './vehicles';

export interface PreviewAsk extends Spot { when: string; exclude?: string | null }
/** a stop of the route the appointment joins, as the strip under the map says it */
export interface StripStop { id: string; n: number | string; name: string; done: boolean; fresh: boolean }

/** the words beside a map whose roads are not all drawn (its own module; said here as before) */
export { roadNote };

/** what is said of a row, as a key that changes only when it does (the screens make a new ask at each drawing) */
const rowSig = (a: Spot) => (a.row ? [a.row.truck, a.row.rank, (a.row.route || []).join(','), a.row.stops].join('|') : '');

/** the day with the new stop in it: every vehicle working that day (the route the appointment joins is drawn stronger),
    and what is said under the map. `when`: the moment's words under the new stop's name (the sheet; the window says
    them in its title) */
function useRouteDay(a: PreviewAsk, when = false) {
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
  // every vehicle working that day is drawn, the one the appointment joins stronger
  const routes = after.trucks.filter((x) => x.stops.length);
  // off: the day without the stop too, for what it adds (the same planner for both, roadAdded)
  useRoads(on ? routes : [...routes, ...(trB && trB.stops.some((s) => s.hasPos) ? [trB] : [])], day);
  const roadA = trA ? roadTotal(trA, day) : null;
  const mine = trA?.stops.find((s) => s.id === NEW_STOP);

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const newMk = (n: number | string): MapMarker => ({ id: NEW_STOP, kind: 'job', lat: a.lat, lng: a.lng, color: NEW_STOP_COLOR, number: n, active: true,
    label: t('booking.preview.newLabel'), sub: when ? a.when : undefined, title: t('booking.preview.newLabel') });
  const homeMk = (): MapMarker | null => (after.home ? { id: 'from', kind: 'home', lat: after.home.lat, lng: after.home.lng, label: after.home.label || t('booking.preview.start'), title: after.home.address || '' } : null);
  /* switch on with the server's order: each stop keeps its place in the server's route; a stop the route does not name
     has no number (never above « sur N », review-moments L2) */
  const numberOf = (s: TruckRoute['stops'][number]): number | string => (s.id === NEW_STOP ? (on && placed.rank ? placed.rank.n : s.n) : on && placed.rank ? s.order ?? '' : s.n);
  let homeDrawn = false;
  for (const tr of routes) {
    const own = tr.id === placed.truckId;
    if (tr.from && tr.start) markers.push({ id: `from-${tr.id}`, kind: 'customer', lat: tr.from[0], lng: tr.from[1], color: tr.color, label: tr.start.label || t('booking.preview.start'), title: tr.start.address || '' });
    else if (tr.from && !homeDrawn) { homeDrawn = true; markers.push({ id: 'from', kind: 'home', lat: tr.from[0], lng: tr.from[1], label: after.home?.label || t('booking.preview.start'), title: after.home?.address || '' }); }
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      if (s.id === NEW_STOP) markers.push(newMk(numberOf(s)));
      else { const n = numberOf(s); markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: n, done: s.done, title: n === '' ? s.name : `${n}. ${s.name}` }); }
    }
    // the other vehicles' routes are drawn lighter: the eye goes to the route the appointment joins
    for (const leg of tr.legs) lines.push({ points: roadOf(leg, day), color: tr.color, weight: own ? 5 : 3, opacity: leg.kind === 'done' ? 0.32 : own ? 0.9 : 0.6 });
  }
  for (const s of after.unplaced) if (s.hasPos && s.id !== NEW_STOP) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '', title: s.name });
  if (!markers.some((m) => m.id === NEW_STOP)) {
    // the new stop outside any route (nobody works that day yet: with where the vehicles leave from): switch on, its
    // place is not known (no number); off, alone that day (« 1 »)
    const home = homeDrawn ? null : homeMk();
    if (home) markers.push(home);
    markers.push(newMk(on ? '' : '1'));
  }

  // the route is the car's or the truck's: no vehicle or mechanic name
  const trucks = activeTrucks.value;
  const both = bothKinds(trucks);
  const truckName = both ? t(kindOf(trucks, placed.truckId) === 'car' ? 'booking.kind.ofCar' : 'booking.kind.ofTruck') : t('booking.kind.ofRoute');
  const note = roadNote(routes.filter((tr) => tr.stops.some((s) => s.hasPos)), day);

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
  // the stops of the route the appointment joins, in its order, numbered as on the map
  const strip: StripStop[] = trA && mine ? trA.stops.map((s) => ({ id: s.id, n: numberOf(s), name: s.id === NEW_STOP ? t('booking.preview.newLabel') : s.name, done: s.done, fresh: s.id === NEW_STOP })) : [];
  return { markers, lines, stop, dayLine, adds, alone, note, on, color: trA?.color, strip };
}

/** « Voir sur la carte » in a sheet (`onPick`: « Choisir ce moment », only for a moment that can be chosen) */
export function RoutePreview(p: { ask: PreviewAsk; onClose?: () => void; onPick?: () => void }) {
  const a = p.ask;
  const { markers, lines, stop, dayLine, adds, alone, note, on } = useRouteDay(a, true);
  const close = () => p.onClose?.();
  return (
    <Sheet open onClose={close} title={t('booking.preview.title')} sub={a.when} data-testid="route-preview"
      footer={<>
        <Button onClick={close}>{t('common.close')}</Button>
        {p.onPick && <Button variant="primary" onClick={() => { p.onPick!(); close(); }} data-testid="route-preview-pick">{t('booking.preview.pick')}</Button>}
      </>}>
      <div class="stack">
        <MapView markers={markers} lines={lines} height="400px" label={t('booking.preview.mapLabel')} data-testid="route-preview-map" />
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

/** the map window beside what the mouse is on (computers only): a real map, as big as the screen lets it be. `at` is
    the box on screen of the moment under the mouse, `group` the whole picker's (the window goes beside it and stays
    there from a moment to the next). It never takes the mouse: a click still chooses the moment. */
export function MapHover(p: { at: Rect; group?: Rect | null; title: string; markers: MapMarker[]; lines?: MapLine[];
  /** the stops of the route the appointment joins, in order, in that route's colour */
  stops?: StripStop[]; color?: string; facts?: ComponentChildren; far?: boolean; 'data-testid'?: string }) {
  const at = popPlace(p.at, p.group ?? null, window.innerWidth, window.innerHeight);
  const box = useRef<HTMLDivElement>(null);
  // the words under the map take the room they need: a window that would go under the screen is pushed back up
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.top = `${at.top}px`;
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - POP.edge);
    if (over > 0) el.style.top = `${Math.max(POP.edge, at.top - over)}px`;
  });
  const stops = p.stops || [];
  return createPortal(
    <div ref={box} class="bp-pop" style={{ left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px` }} aria-hidden="true" data-testid={p['data-testid'] || 'route-hover'} data-aside={at.aside ? '1' : '0'}>
      <b class="bp-pop-when">{p.title}</b>
      <MapView markers={p.markers} lines={p.lines || []} height={`${at.mapH}px`} controls={false} fitPadding={[48, 132, 44, 48]} data-testid="route-hover-map" />
      {stops.length > 0 && (
        <ol class="bp-pop-stops" style={{ '--c': p.color || NEW_STOP_COLOR }} data-testid="route-hover-stops">
          {stops.map((s) => (
            <li key={s.id} class={`bp-pop-stop${s.fresh ? ' is-new' : ''}${s.done ? ' is-done' : ''}`}><i>{s.n}</i>{s.name && <span>{s.name}</span>}</li>
          ))}
        </ol>
      )}
      {p.facts && <p class="bp-pop-facts" data-testid="route-hover-facts">{p.facts}</p>}
      {p.far && <span class="bp-pop-far">{t('booking.far.legend')}</span>}
    </div>, document.body);
}

/** the day's routes with the new appointment, in the window beside the moment under the mouse. `title`: the words above
    the map (else the moment's own); `road`: what the server says of the drive (blocks), else what the appointment adds
    by the streets (never a straight-line distance) */
export function RouteHover(p: { ask: PreviewAsk; at: Rect; group?: Rect | null; title?: string; road?: string; far?: boolean }) {
  const { markers, lines, stop, adds, alone, note, color, strip } = useRouteDay(p.ask);
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // where it goes in the route, then the drive (the server's words in blocks mode, else what it adds by the streets),
  // then why a road is not drawn yet
  const drive = p.road ? cap(p.road) : alone ? '' : adds;
  const facts = (
    <>
      {alone ? <span>{t('booking.preview.noTruck')}</span> : stop ? <b>{stop}</b> : null}
      {drive && <span>{drive}</span>}
      {note && <span>{note}</span>}
    </>
  );
  return <MapHover at={p.at} group={p.group} title={p.title || p.ask.when} markers={markers} lines={lines} stops={strip} color={color} facts={facts} far={p.far} />;
}
