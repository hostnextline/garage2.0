/* « Voir sur la carte » of a day of the booking calendar when there is no address yet to place a new stop: the routes of
   that day as they are (every vehicle, its stops in order, by the streets). From the phone's copy of the day. */
import { useMemo } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { longDay } from '../../lib/dates';
import { Sheet, Button, Banner } from '../../ui';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble } from '../map/assemble';
import { fromDevice } from '../map/device';
import { useRoads, roadOf } from '../map/useRoads';
import { staffName } from '../../data/select';

export function DayRoute(p: { day: string; exclude?: string | null; onClose: () => void }) {
  const l = lang.value;
  const view = useMemo(() => {
    const day = fromDevice(p.day);
    return assemble(p.exclude ? { ...day, jobs: day.jobs.filter((j) => j.id !== p.exclude) } : day, { nameOf: staffName });
  }, [p.day, p.exclude]);
  const routes = view.trucks.filter((tr) => tr.stops.some((s) => s.hasPos));
  useRoads(routes);
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const seen = new Set<string>();
  for (const tr of routes) {
    if (tr.from) {
      const key = `${tr.from[0]},${tr.from[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        markers.push({ id: `from-${tr.id}`, kind: tr.start ? 'customer' : 'home', lat: tr.from[0], lng: tr.from[1], color: tr.color,
          label: tr.start?.label || view.home?.label || t('booking.preview.start'), title: tr.start?.address || view.home?.address || '' });
      }
    }
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done, title: `${s.n}. ${s.name}` });
    }
    for (const leg of tr.legs) lines.push({ points: roadOf(leg), color: tr.color, weight: 4, opacity: leg.kind === 'done' ? 0.32 : 0.85 });
  }
  if (!markers.length && view.home && view.home.lat != null && view.home.lng != null) {
    markers.push({ id: 'home', kind: 'home', lat: view.home.lat, lng: view.home.lng, label: view.home.label || t('booking.preview.start'), title: view.home.address || '' });
  }
  const stops = routes.reduce((n, tr) => n + tr.stops.length, 0);
  const day = longDay(p.day, l);
  return (
    <Sheet open onClose={p.onClose} title={t('booking.win.dayMap.title')} sub={day.charAt(0).toUpperCase() + day.slice(1)} data-testid="day-route"
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="stack">
        <MapView markers={markers} lines={lines} height="340px" label={t('booking.preview.mapLabel')} data-testid="day-route-map" />
        {stops
          ? <p class="small" style={{ margin: 0 }} data-testid="day-route-facts">{t('booking.win.dayMap.stops', { n: stops })}</p>
          : <Banner kind="info">{t('booking.win.dayMap.none')}</Banner>}
        <p class="faint small" style={{ margin: 0 }}>{t('booking.win.dayMap.note')}</p>
      </div>
    </Sheet>
  );
}
