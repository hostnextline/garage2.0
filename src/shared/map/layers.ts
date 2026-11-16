/* What the team map draws for a day (« Carte »): the start of the trucks, each truck's own start, its numbered stops,
   the stops « À placer », the people on the road, and each truck's route (by the streets once known). The screen's state
   (the stop chosen, the truck seen alone) changes what is faded and what is labelled. Pure: tested in layers.test.ts. */
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { minuteOf, UNPLACED_COLOR, type Assembled, type Leg, type LatLng } from './assemble';
import { ago, minutesSince } from './ago';
import type { MapMarker, MapLine } from './markers';

/** a position older than that (and not at a customer's) is faded, « Dernière position il y a … » */
export const STALE_MIN = 15;

export interface MapUi {
  /** the stop chosen (its card is open) */
  selected: string | null;
  /** a truck id, 'unplaced', or null (everyone) */
  focus: string | null;
  /** a stop chosen in the list: the view goes to it */
  pan: string | null;
  /** now (ms), for the age of the positions */
  now: number;
  /** a stop tapped on the map */
  onChoose: (id: string) => void;
  /** the road of a leg (the streets once the planner answered) */
  road: (leg: Leg) => LatLng[];
}

/** faded while another truck (or « À placer ») is seen alone */
export function dimTruck(m: Assembled, focus: string | null, truckId: string | null): boolean {
  if (focus == null) return false;
  if (focus === 'unplaced') return truckId != null && m.trucks.some((tr) => tr.id === truckId);
  return focus !== truckId;
}

export function teamMarkers(m: Assembled, ui: MapUi): MapMarker[] {
  const l = lang.value;
  const out: MapMarker[] = [];
  if (m.home) out.push({ id: 'home', kind: 'home', lat: m.home.lat, lng: m.home.lng, label: m.home.label, title: [m.home.label, m.home.address].filter(Boolean).join(', ') });
  // a truck that leaves from its own address: its start, in its colour
  for (const tr of m.trucks) {
    if (!tr.start) continue;
    const name = tr.start.label || t('map.legend.ownStart', { name: tr.name });
    out.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.start.lat, lng: tr.start.lng, color: tr.color, label: name, dim: dimTruck(m, ui.focus, tr.id),
      title: [name, tr.start.address].filter(Boolean).join(', ') });
  }
  for (const tr of m.trucks) {
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      const tripHere = tr.trip && tr.trip.jobId === s.id && !s.done ? tr.trip : null;
      const etaMin = tripHere ? minuteOf(tripHere.etaAt) : null;
      const chosen = ui.selected === s.id;
      out.push({
        id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done,
        active: chosen || !!tripHere, dim: dimTruck(m, ui.focus, tr.id),
        label: chosen ? s.name : tripHere && etaMin != null ? t('map.tripLabel', { time: clock(etaMin, l) }) : undefined,
        sub: chosen ? tr.name : undefined,
        title: `${t('map.stop.number', { n: s.n })}, ${s.name}`, onClick: () => ui.onChoose(s.id)
      });
    }
  }
  for (const s of m.unplaced) {
    if (!s.hasPos) continue;
    const chosen = ui.selected === s.id;
    out.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '?', active: chosen, dim: ui.focus != null && ui.focus !== 'unplaced',
      label: chosen ? s.name : undefined, title: `${t('map.legend.unplaced')}, ${s.name}`, onClick: () => ui.onChoose(s.id) });
  }
  for (const p of m.people) {
    const age = minutesSince(p.at, ui.now);
    // working at a customer's: never « old » (his phone sleeps while he works), he is there
    const stale = !p.onSite && age != null && age >= STALE_MIN;
    out.push({ id: `p:${p.id}`, kind: 'person', lat: p.lat, lng: p.lng, color: p.color, label: p.name,
      sub: p.onSite ? t('map.people.onSite', { name: p.onSite.name }) : stale ? t('map.people.stale', { ago: ago(p.at, ui.now) }) : ago(p.at, ui.now),
      dim: stale || (ui.focus != null && ui.focus !== p.truckId), title: p.name });
  }
  return out;
}

export function teamLines(m: Assembled, ui: Pick<MapUi, 'focus' | 'road'>): MapLine[] {
  const out: MapLine[] = [];
  for (const tr of m.trucks) {
    const dim = dimTruck(m, ui.focus, tr.id);
    for (const leg of tr.legs) {
      // by the streets once the route planner answered (a live trip follows them already when the server had its road)
      out.push({ points: ui.road(leg), color: tr.color, dashed: leg.kind === 'trip', weight: leg.kind === 'trip' ? 5 : 4,
        opacity: dim ? 0.14 : leg.kind === 'done' ? 0.32 : leg.kind === 'trip' ? 0.95 : 0.8 });
    }
  }
  return out;
}

/** the markers the view fits: the stop chosen in the list; the truck seen alone (its stops and the person driving it);
    « À placer »; null = everyone */
export function fitIds(m: Assembled, ui: Pick<MapUi, 'focus' | 'pan'>): string[] | null {
  if (ui.pan) return [ui.pan];
  if (ui.focus === 'unplaced') return m.unplaced.filter((s) => s.hasPos).map((s) => s.id);
  if (!ui.focus) return null;
  const tr = m.trucks.find((x) => x.id === ui.focus);
  if (!tr) return null;
  const ids = tr.stops.filter((s) => s.hasPos).map((s) => s.id);
  // the person who drives it today first (« Routes partagées »), its usual driver otherwise
  const p = m.people.find((x) => x.truckId === tr.id) || m.people.find((x) => x.id === tr.driverId);
  if (p) ids.push(`p:${p.id}`);
  return ids.length ? ids : null;
}
