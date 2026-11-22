/* « Réorganiser la journée »: the map of that day that follows the draft (Part 30, K4; Hassan, 2026-11-22: « when i am
   rearranging the appointements, i want to be able to have the map open and showing me the changements in real time »).
   Pure (draftMap.test.ts): what the map draws for a draft, from the day as the phone has it (the shape of team_map).
   - Every stop of the draft on its DRAFT truck at its DRAFT place, then `assemble` (the Carte's own: the trucks in the
     same order, so the same colour per truck as on the Carte; each truck's route from its own start, else « Départ des
     camions », through its stops in order). The people and the live trips are left out: this is a plan, not the live map.
   - The pins are numbered as the sheet's rows are (a stop under way first, 1…; then the booked ones in the draft order):
     a stop dropped somewhere takes its new number at once, and so do the others. A stop done keeps the Carte's check.
   - The arrival of a stop is the one its row prints: the server's answer for this very draft (« fixé à … » for a stop
     dragged, Part 29), else the stored plan while its truck is unchanged (or for a stop not dragged); none while it is
     worked out, none for a trip not measured.
   - A line between two stops is a road the route planner already gave (`road`, useRoads' roadOf): until it comes, NOTHING
     (Hassan's rule, 2026-11-19: never a straight line, not even dotted).
   - The map's choice, open or not, is kept on this device (one for a phone, one for a computer), every read and write in a
     try (a private window, storage full: the map works without it). */
import type { Job } from '../../data/types';
import type { DayAnswer } from '../../data/dayOrder';
import type { Draft } from '../../domain/jobs/dayOrder';
import { t, type Lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import type { Assembled, Leg, LatLng, TeamMapAnswer, TruckRoute } from '../map/assemble';
import type { MapLine, MapMarker } from '../map/markers';

/** how long after the LAST change of the draft its roads are asked (the same pause as its times: DAY_ORDER_WAIT_MS) */
export const ROAD_WAIT_MS = 600;

/* ---------- the day in the draft's order ---------- */

/** the day (team_map's shape, the phone's copy) with every stop of the draft on its draft truck at its draft place; a stop
    done stays where it was on a truck shown; anything else (a truck the draft does not show, « À placer ») is left out;
    no people, no trips */
export function draftAnswer(base: TeamMapAnswer, d: Draft): TeamMapAnswer {
  const place = new Map<string, { truck: string; order: number }>();
  for (const l of d.lists) {
    l.live.forEach((id, i) => place.set(id, { truck: l.truck, order: i + 1 }));
    l.jobs.forEach((id, i) => place.set(id, { truck: l.truck, order: l.live.length + i + 1 }));
  }
  const shown = new Set(d.lists.map((l) => l.truck));
  const jobs = base.jobs.flatMap((j) => {
    const p = place.get(j.id);
    if (p) return [{ ...j, truck_id: p.truck, order: p.order }];
    return j.status === 'done' && !!j.truck_id && shown.has(j.truck_id) ? [j] : [];
  });
  return { ...base, jobs, people: [], trips: [] };
}

/** each stop under way or booked → its number, as its row in the sheet says it (its place in its truck's list) */
export function numbersOf(d: Draft): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of d.lists) {
    l.live.forEach((id, i) => out.set(id, i + 1));
    l.jobs.forEach((id, i) => out.set(id, l.live.length + i + 1));
  }
  return out;
}

/** the trucks of the draft, in the draft's order, as assembled (a truck with no stop left has no route) */
export function draftTrucks(m: Assembled, d: Draft): TruckRoute[] {
  const ids = d.lists.map((l) => l.truck).filter((x, i, a) => a.indexOf(x) === i);
  return ids.map((id) => m.trucks.find((tr) => tr.id === id)).filter((tr): tr is TruckRoute => !!tr);
}

/** the points of every truck's route, written once (the roads are asked again only when this changes) */
export function routesKey(trucks: readonly Pick<TruckRoute, 'from' | 'stops'>[]): string {
  const k = (p: LatLng | null) => (p ? `${p[0].toFixed(5)},${p[1].toFixed(5)}` : '-');
  return trucks.map((tr) => [k(tr.from), ...tr.stops.filter((s) => s.hasPos).map((s) => k([s.lat!, s.lng!]))].join(';')).join('|');
}

/* ---------- the arrival of a stop ---------- */

export interface TimeCtx {
  /** the server's answer for THIS draft (null: not yet, or none) */
  cur: DayAnswer | null;
  /** something changed (the verdict is shown: « fixé à … » only then) */
  judge: boolean;
  /** the trucks whose list differs from the basis */
  changed: ReadonlySet<string>;
  /** the stops dragged in this draft (movedOf) */
  dragged: ReadonlySet<string>;
  /** « Laisser l'app choisir » made this order */
  auto: boolean;
  row: (id: string) => Pick<Job, 'eta_min' | 'eta_measured' | 'status'> | undefined;
  /** a time counted with a trip not measured (etaUnsure): never printed */
  unsure: (j: Pick<Job, 'eta_min' | 'eta_measured' | 'status'>) => boolean;
}
export interface Arrival { min: number; fixed: boolean }
/** the arrival the row of that stop prints (StopRow): the server's for this draft, else the stored plan when it still
    holds; null = no time said (being worked out, not measured) */
export function arrivalOf(id: string, truck: string, c: TimeCtx): Arrival | null {
  const s = c.cur ? c.cur.byId.get(id) ?? null : null;
  if (s) {
    if (s.measured === false) return null;
    const pinned = c.judge && s.pinNew ? (s.pin ?? s.eta) : null;
    if (pinned != null) return { min: pinned, fixed: true };
    return s.eta != null ? { min: s.eta, fixed: false } : null;
  }
  const known = !!c.cur || !c.changed.has(truck) || (!c.auto && !c.dragged.has(id));
  const j = c.row(id);
  if (!known || !j || c.unsure(j) || j.eta_min == null) return null;
  return { min: j.eta_min, fixed: false };
}

/* ---------- what the map draws ---------- */

export interface LayerCtx extends TimeCtx {
  l: Lang;
  numbers: ReadonlyMap<string, number>;
  /** the stop just put down: marked (bigger, its name) */
  marked: string | null;
  /** the stop pointed at (its row hovered or opened, its pin tapped): its name */
  spot: string | null;
  /** the road of a leg, once the route planner gave it; [] before (nothing drawn) */
  road: (leg: Leg) => LatLng[];
  onPick?: (id: string) => void;
  /** « Départ des camions » */
  homeLabel?: string;
}
/** the words of an arrival on a pin: « fixé à 15 h 29 », « vers 10 h 40 » */
export const arrivalWords = (a: Arrival, l: Lang) => t(a.fixed ? 'reorg.atFixed' : 'reorg.at', { time: clock(a.min, l) }, l);

export function draftLayers(m: Assembled, trucks: readonly TruckRoute[], c: LayerCtx): { markers: MapMarker[]; lines: MapLine[] } {
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  if (m.home && trucks.some((tr) => !tr.start)) {
    const label = c.homeLabel || m.home.label;
    markers.push({ id: 'home', kind: 'home', lat: m.home.lat, lng: m.home.lng, label, title: [label, m.home.address].filter(Boolean).join(', ') });
  }
  for (const tr of trucks) {
    if (tr.start) {
      const name = tr.start.label || t('map.legend.ownStart', { name: tr.name }, c.l);
      markers.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.start.lat, lng: tr.start.lng, color: tr.color, label: name, title: [name, tr.start.address].filter(Boolean).join(', ') });
    }
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      const n = c.numbers.get(s.id) ?? s.n;
      const pick = c.onPick ? () => c.onPick!(s.id) : undefined;
      if (s.done) {
        markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: n, done: true, title: `${s.name} (${t('reorg.mapDone', undefined, c.l)})`, onClick: pick });
        continue;
      }
      const named = c.marked === s.id || c.spot === s.id;
      if (s.live) {
        const what = t(s.status === 'on_site' ? 'reorg.mapOnSite' : 'reorg.mapEnRoute', undefined, c.l);
        markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: n, active: named || s.status === 'en_route',
          label: named ? s.name : undefined, sub: what, title: `${n}. ${s.name}, ${what}`, onClick: pick });
        continue;
      }
      const a = arrivalOf(s.id, tr.id, c);
      const words = a ? arrivalWords(a, c.l) : '';
      markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: n, active: named,
        label: named ? s.name : undefined, sub: named ? words || undefined : a ? clock(a.min, c.l) : undefined,
        title: `${n}. ${s.name}${words ? `, ${words}` : ''}`, onClick: pick });
    }
    // by the streets once the route planner answered (that day, that order); nothing before
    for (const leg of tr.legs) lines.push({ points: c.road(leg), color: tr.color, weight: 4, opacity: leg.kind === 'done' ? 0.32 : 0.85 });
  }
  return { markers, lines };
}

/* ---------- open or not, on this device ---------- */

const MAP_KEY = (where: 'phone' | 'wide') => `his.dayOrder.map.${where}`;
/** the map open in « Réorganiser la journée » on this device: a computer opens it by default, a phone not */
export function mapOpenPref(where: 'phone' | 'wide'): boolean {
  try {
    const v = localStorage.getItem(MAP_KEY(where));
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* no storage: the default */ }
  return where === 'wide';
}
export function keepMapOpen(where: 'phone' | 'wide', open: boolean): void {
  try { localStorage.setItem(MAP_KEY(where), open ? '1' : '0'); } catch { /* not kept: open for this time only */ }
}
