/* « Voir sur la carte » (a right-click or a long press on a moment offered, or the button under the moment chosen): the
   truck's day by the streets with the new appointment in its place, its stop number, the day's route and what the new
   appointment adds to it. From the phone's copy of the day; the streets from the route planner (straight lines meanwhile). */
import { useMemo } from 'preact/hooks';
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
import { floatStyle, hoverBox, HOVER_W, type FloatAt, type Rect } from './place';
import { bothKinds, kindOf } from './vehicles';

export interface PreviewAsk extends Spot { when: string; exclude?: string | null }

/** the day of the vehicle with the new stop in it: what the map draws and what is said under it */
function useRouteDay(a: PreviewAsk, all = false) {
  const placed = useMemo(() => placeNewStop(dayOf(a.day, a.exclude), a), [a.day, a.block, a.truckId, a.lat, a.lng, a.exclude, a.eta]);
  const after = useMemo(() => assemble(placed.after, { nameOf: staffName }), [placed]);
  const before = useMemo(() => assemble(placed.before, { nameOf: staffName }), [placed]);
  const trA: TruckRoute | undefined = after.trucks.find((x) => x.id === placed.truckId);
  const trB: TruckRoute | undefined = before.trucks.find((x) => x.id === placed.truckId);
  // all: every vehicle working that day is drawn (the small window), not only the one the appointment goes on
  useRoads(all ? [...after.trucks.filter((x) => x.stops.length), ...(trB ? [trB] : [])] : [trA, trB].filter((x): x is TruckRoute => !!x));
  const roadA = trA ? roadTotal(trA) : null;
  const roadB = trB ? (trB.stops.some((s) => s.hasPos) ? roadTotal(trB) : { km: 0, minutes: 0 }) : { km: 0, minutes: 0 };
  const mine = trA?.stops.find((s) => s.id === NEW_STOP);

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const newMk = (n: number | string): MapMarker => ({ id: NEW_STOP, kind: 'job', lat: a.lat, lng: a.lng, color: NEW_STOP_COLOR, number: n, active: true,
    label: t('booking.preview.newLabel'), sub: a.when, title: t('booking.preview.newLabel') });
  let homeDrawn = false;
  for (const tr of all ? after.trucks : trA ? [trA] : []) {
    if (!tr.stops.length) continue;
    const own = tr.id === placed.truckId;
    if (tr.from && tr.start) markers.push({ id: `from-${tr.id}`, kind: 'customer', lat: tr.from[0], lng: tr.from[1], color: tr.color, label: tr.start.label || t('booking.preview.start'), title: tr.start.address || '' });
    else if (tr.from && !homeDrawn) { homeDrawn = true; markers.push({ id: 'from', kind: 'home', lat: tr.from[0], lng: tr.from[1], label: after.home?.label || t('booking.preview.start'), title: after.home?.address || '' }); }
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      if (s.id === NEW_STOP) markers.push(newMk(s.n));
      else markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done, title: `${s.n}. ${s.name}` });
    }
    // the other vehicles' routes are drawn lighter: the eye goes to the route the appointment joins
    for (const leg of tr.legs) lines.push({ points: roadOf(leg), color: tr.color, weight: own ? 4 : 3, opacity: leg.kind === 'done' ? 0.32 : own ? 0.85 : 0.6 });
  }
  if (all) for (const s of after.unplaced) if (s.hasPos && s.id !== NEW_STOP) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '', title: s.name });
  if (!markers.some((m) => m.id === NEW_STOP)) markers.push(newMk('1'));

  // what it adds: by the streets once both routes are known, else the straight-line estimate
  const extra = roadA && roadB ? { km: Math.max(0, roadA.km - roadB.km), minutes: Math.max(0, roadA.minutes - roadB.minutes), road: true } : { km: placed.extraKm, minutes: null, road: false };
  // the route is the car's or the truck's: no vehicle or mechanic name
  const trucks = activeTrucks.value;
  const truckName = bothKinds(trucks) ? t(kindOf(trucks, placed.truckId) === 'car' ? 'booking.kind.ofCar' : 'booking.kind.ofTruck') : t('booking.kind.ofRoute');
  return { markers, lines, trA, mine, roadA, extra, truckName };
}

/** « Voir sur la carte » in a sheet (`onPick`: « Choisir ce moment », only for a moment that can be chosen), or with
    `float` the small window beside a moment hovered with a mouse (no buttons, nothing to close: it follows the pointer) */
export function RoutePreview(p: { ask: PreviewAsk; onClose?: () => void; onPick?: () => void; float?: FloatAt }) {
  const l = lang.value;
  const a = p.ask;
  const { markers, lines, trA, mine, roadA, extra, truckName } = useRouteDay(a);
  if (p.float) {
    // drawn on the page itself: inside a glass panel a fixed box is cut by the panel
    return createPortal(
      <div class="bp-hover-map" style={floatStyle(p.float)} role="tooltip" data-testid="route-hover">
        <p class="bp-hover-when">{p.float.title || a.when}</p>
        <MapView markers={markers} lines={lines} height="220px" controls={false} label={t('booking.preview.mapLabel')} data-testid="route-hover-map" />
        {trA && mine ? (
          <p class="bp-hover-facts" data-testid="route-hover-facts">
            <b>{t('booking.preview.stop', { n: mine.n, total: trA.total, truck: truckName })}</b>{' '}
            {extra.road ? t('booking.preview.addsRoad', { km: fmtKm(extra.km, l), d: duration(extra.minutes!, l) }) : t('booking.preview.addsLine', { km: fmtKm(extra.km, l) })}
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
  const { markers, lines, trA, mine, truckName } = useRouteDay(p.ask, true);
  const facts = (trA && mine ? t('booking.preview.stop', { n: mine.n, total: trA.total, truck: truckName }) : t('booking.preview.noTruck')) + (p.road ? ` · ${p.road}` : '');
  return <MapHover at={p.at} title={p.ask.when} markers={markers} lines={lines} facts={facts} far={p.far} />;
}
