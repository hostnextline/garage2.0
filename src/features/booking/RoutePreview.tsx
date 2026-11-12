/* « Voir sur la carte » (a right-click or a long press on a moment offered, or the button under the moment chosen): the
   truck's day by the streets with the new appointment in its place, its stop number, the day's route and what the new
   appointment adds to it. From the phone's copy of the day; the streets from the route planner (straight lines meanwhile). */
import { useMemo } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { Sheet, Button, Banner } from '../../ui';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, type TruckRoute } from '../map/assemble';
import { fromDevice } from '../map/device';
import { useRoads, roadOf, roadTotal } from '../map/useRoads';
import { staffName, activeTrucks } from '../../data/select';
import { placeNewStop, NEW_STOP, type Spot } from './preview';

export interface PreviewAsk extends Spot { when: string; exclude?: string | null }

const fmtKm = (n: number, l: string) => new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }).format(n);

export function RoutePreview(p: { ask: PreviewAsk; onClose: () => void; onPick?: () => void }) {
  const l = lang.value;
  const a = p.ask;
  const placed = useMemo(() => {
    const day = fromDevice(a.day);
    // moving an appointment: it is not in its old place any more
    const base = a.exclude ? { ...day, jobs: day.jobs.filter((j) => j.id !== a.exclude) } : day;
    return placeNewStop(base, a);
  }, [a.day, a.block, a.truckId, a.lat, a.lng, a.exclude]);
  const after = useMemo(() => assemble(placed.after, { nameOf: staffName }), [placed]);
  const before = useMemo(() => assemble(placed.before, { nameOf: staffName }), [placed]);
  const trA: TruckRoute | undefined = after.trucks.find((x) => x.id === placed.truckId);
  const trB: TruckRoute | undefined = before.trucks.find((x) => x.id === placed.truckId);
  useRoads([trA, trB].filter((x): x is TruckRoute => !!x));
  const roadA = trA ? roadTotal(trA) : null;
  const roadB = trB ? (trB.stops.some((s) => s.hasPos) ? roadTotal(trB) : { km: 0, minutes: 0 }) : { km: 0, minutes: 0 };
  const mine = trA?.stops.find((s) => s.id === NEW_STOP);

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  if (trA?.from) {
    const start = trA.start;
    markers.push({ id: 'from', kind: start ? 'customer' : 'home', lat: trA.from[0], lng: trA.from[1], color: trA.color,
      label: start?.label || after.home?.label || t('booking.preview.start'), title: start?.address || after.home?.address || '' });
  }
  for (const s of trA?.stops || []) {
    if (!s.hasPos) continue;
    const isNew = s.id === NEW_STOP;
    markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: isNew ? '#111827' : trA!.color, number: s.n, done: s.done, active: isNew,
      label: isNew ? t('booking.preview.newLabel') : undefined, sub: isNew ? a.when : undefined, title: `${s.n}. ${isNew ? t('booking.preview.newLabel') : s.name}` });
  }
  if (!trA) markers.push({ id: NEW_STOP, kind: 'job', lat: a.lat, lng: a.lng, color: '#111827', number: '1', active: true, label: t('booking.preview.newLabel'), sub: a.when });
  for (const leg of trA?.legs || []) lines.push({ points: roadOf(leg), color: trA!.color, weight: 4, opacity: leg.kind === 'done' ? 0.32 : 0.85 });

  // what it adds: by the streets once both routes are known, else the straight-line estimate
  const extra = roadA && roadB ? { km: Math.max(0, roadA.km - roadB.km), minutes: Math.max(0, roadA.minutes - roadB.minutes), road: true } : { km: placed.extraKm, minutes: null, road: false };
  // the route is the car's or the truck's: no vehicle or mechanic name
  const both = activeTrucks.value.some((x) => x.tire_machine === false) && activeTrucks.value.some((x) => x.tire_machine !== false);
  const isCar = activeTrucks.value.find((x) => x.id === placed.truckId)?.tire_machine === false;
  const truckName = both ? t(isCar ? 'booking.kind.ofCar' : 'booking.kind.ofTruck') : t('booking.kind.ofRoute');
  return (
    <Sheet open onClose={p.onClose} title={t('booking.preview.title')} sub={a.when} data-testid="route-preview"
      footer={<>
        <Button onClick={p.onClose}>{t('common.close')}</Button>
        {p.onPick && <Button variant="primary" onClick={() => { p.onPick!(); p.onClose(); }} data-testid="route-preview-pick">{t('booking.preview.pick')}</Button>}
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
