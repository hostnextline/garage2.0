/* The day on the map with the new appointment in it, two ways:
   - « Voir sur la carte » (a right-click or a long press on a moment offered, or the button under the moment chosen): a
     sheet, with « Choisir ce moment »;
   - on a computer, the mouse resting on a moment (a best moment, a time of the calendar, a block): the same map in a
     window beside the picker (RouteHover). It is the real map of that day, big enough to read: every vehicle's route by
     the streets, its numbered stops, the new appointment in black, and under it the stops of the route it joins.
   From the phone's copy of the day; the streets from the route planner (straight lines meanwhile). */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { t, lang } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { Sheet, Button, Banner } from '../../ui';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, UNPLACED_COLOR, type TruckRoute } from '../map/assemble';
import { useRoads, roadOf, roadTotal } from '../map/useRoads';
import { staffName, activeTrucks } from '../../data/select';
import { placeNewStop, fmtKm, NEW_STOP, NEW_STOP_COLOR, type Spot } from './preview';
import { dayOf } from './deviceDay';
import { popPlace, POP, type Rect } from './place';
import { bothKinds, kindOf } from './vehicles';

export interface PreviewAsk extends Spot { when: string; exclude?: string | null }
/** a stop of the route the appointment joins, as the strip under the map says it */
export interface StripStop { id: string; n: number; name: string; done: boolean; fresh: boolean }

/** the day with the new stop in it: every vehicle working that day (the route the appointment joins is drawn stronger),
    and what is said under the map. `when`: the moment's words under the new stop's name (the sheet; the window says
    them in its title) */
function useRouteDay(a: PreviewAsk, when = false) {
  const placed = useMemo(() => placeNewStop(dayOf(a.day, a.exclude), a), [a.day, a.block, a.truckId, a.lat, a.lng, a.exclude, a.eta]);
  const after = useMemo(() => assemble(placed.after, { nameOf: staffName }), [placed]);
  const before = useMemo(() => assemble(placed.before, { nameOf: staffName }), [placed]);
  const trA: TruckRoute | undefined = after.trucks.find((x) => x.id === placed.truckId);
  const trB: TruckRoute | undefined = before.trucks.find((x) => x.id === placed.truckId);
  const routes = after.trucks.filter((x) => x.stops.length);
  useRoads([...routes, ...(trB ? [trB] : [])]);
  const roadA = trA ? roadTotal(trA) : null;
  const roadB = trB ? (trB.stops.some((s) => s.hasPos) ? roadTotal(trB) : { km: 0, minutes: 0 }) : { km: 0, minutes: 0 };
  const mine = trA?.stops.find((s) => s.id === NEW_STOP);

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const newMk = (n: number | string): MapMarker => ({ id: NEW_STOP, kind: 'job', lat: a.lat, lng: a.lng, color: NEW_STOP_COLOR, number: n, active: true,
    label: t('booking.preview.newLabel'), sub: when ? a.when : undefined, title: t('booking.preview.newLabel') });
  const homeMk = (): MapMarker | null => (after.home ? { id: 'from', kind: 'home', lat: after.home.lat, lng: after.home.lng, label: after.home.label || t('booking.preview.start'), title: after.home.address || '' } : null);
  let homeDrawn = false;
  for (const tr of routes) {
    const own = tr.id === placed.truckId;
    if (tr.from && tr.start) markers.push({ id: `from-${tr.id}`, kind: 'customer', lat: tr.from[0], lng: tr.from[1], color: tr.color, label: tr.start.label || t('booking.preview.start'), title: tr.start.address || '' });
    else if (tr.from && !homeDrawn) { homeDrawn = true; markers.push({ id: 'from', kind: 'home', lat: tr.from[0], lng: tr.from[1], label: after.home?.label || t('booking.preview.start'), title: after.home?.address || '' }); }
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      if (s.id === NEW_STOP) markers.push(newMk(s.n));
      else markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done, title: `${s.n}. ${s.name}` });
    }
    // the other vehicles' routes are drawn lighter: the eye goes to the route the appointment joins
    for (const leg of tr.legs) lines.push({ points: roadOf(leg), color: tr.color, weight: own ? 5 : 3, opacity: leg.kind === 'done' ? 0.32 : own ? 0.9 : 0.6 });
  }
  for (const s of after.unplaced) if (s.hasPos && s.id !== NEW_STOP) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '', title: s.name });
  if (!markers.some((m) => m.id === NEW_STOP)) {
    // nobody works that day yet: the appointment alone, with where the vehicles leave from
    const home = homeDrawn ? null : homeMk();
    if (home) markers.push(home);
    markers.push(newMk('1'));
  }

  // what it adds: by the streets once both routes are known, else the straight-line estimate
  const extra = roadA && roadB ? { km: Math.max(0, roadA.km - roadB.km), minutes: Math.max(0, roadA.minutes - roadB.minutes), road: true } : { km: placed.extraKm, minutes: null, road: false };
  // the route is the car's or the truck's: no vehicle or mechanic name
  const trucks = activeTrucks.value;
  const truckName = bothKinds(trucks) ? t(kindOf(trucks, placed.truckId) === 'car' ? 'booking.kind.ofCar' : 'booking.kind.ofTruck') : t('booking.kind.ofRoute');
  const strip: StripStop[] = trA && mine ? trA.stops.map((s) => ({ id: s.id, n: s.n, name: s.id === NEW_STOP ? t('booking.preview.newLabel') : s.name, done: s.done, fresh: s.id === NEW_STOP })) : [];
  return { markers, lines, trA, mine, roadA, extra, truckName, strip };
}

/** « Voir sur la carte » in a sheet (`onPick`: « Choisir ce moment », only for a moment that can be chosen) */
export function RoutePreview(p: { ask: PreviewAsk; onClose?: () => void; onPick?: () => void }) {
  const l = lang.value;
  const a = p.ask;
  const { markers, lines, trA, mine, roadA, extra, truckName } = useRouteDay(a, true);
  const close = () => p.onClose?.();
  return (
    <Sheet open onClose={close} title={t('booking.preview.title')} sub={a.when} data-testid="route-preview"
      footer={<>
        <Button onClick={close}>{t('common.close')}</Button>
        {p.onPick && <Button variant="primary" onClick={() => { p.onPick!(); close(); }} data-testid="route-preview-pick">{t('booking.preview.pick')}</Button>}
      </>}>
      <div class="stack">
        <MapView markers={markers} lines={lines} height="400px" label={t('booking.preview.mapLabel')} data-testid="route-preview-map" />
        {trA && mine ? (
          <ul class="bp-preview-facts" data-testid="route-preview-facts">
            <li><b>{t('booking.preview.stop', { n: mine.n, total: trA.total, truck: truckName })}</b></li>
            {roadA && <li>{t('booking.preview.day', { km: fmtKm(roadA.km, l), d: duration(roadA.minutes, l) })}</li>}
            <li data-testid="route-preview-extra">{extra.road
              ? t('booking.preview.addsRoad', { km: fmtKm(extra.km, l), d: duration(extra.minutes!, l) })
              : t('booking.preview.addsLine', { km: fmtKm(extra.km, l) })}</li>
          </ul>
        ) : <Banner kind="info">{t('booking.preview.noTruck')}</Banner>}
        <p class="faint small" style={{ margin: 0 }}>{t('booking.preview.note')}</p>
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
    by the streets */
export function RouteHover(p: { ask: PreviewAsk; at: Rect; group?: Rect | null; title?: string; road?: string; far?: boolean }) {
  const l = lang.value;
  const { markers, lines, trA, mine, extra, truckName, strip } = useRouteDay(p.ask);
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // two lines: where it goes in the route, then the drive (the server's words in blocks mode, else what it adds by the streets)
  const facts = trA && mine ? (
    <>
      <b>{t('booking.preview.stop', { n: mine.n, total: trA.total, truck: truckName })}</b>
      <span>{p.road ? cap(p.road) : extra.road ? t('booking.preview.addsRoad', { km: fmtKm(extra.km, l), d: duration(extra.minutes!, l) }) : t('booking.preview.addsLine', { km: fmtKm(extra.km, l) })}</span>
    </>
  ) : <><span>{t('booking.preview.noTruck')}</span>{p.road && <span>{cap(p.road)}</span>}</>;
  return <MapHover at={p.at} group={p.group} title={p.title || p.ask.when} markers={markers} lines={lines} stops={strip} color={trA?.color} facts={facts} far={p.far} />;
}
