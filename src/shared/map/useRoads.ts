/* The trucks' routes by the streets, for every map of a day (« Carte », « Aperçu », « Voir sur la carte » of a booking):
   each truck's route (its start, then its stops in order) is asked once from the route planner (roads.ts), one truck at a
   time, for THAT day (today: the traffic of now; another day: its usual hours; `day` left out = today); a live trip that
   has no road from the server (the mechanic's position → the stop) is asked too, at most once a minute for the same stop,
   and never when the server gave its road. Until the answer comes (or when no planner answers) NOTHING is drawn between
   two stops (Hassan's rule, 2026-11-19: a road is a real road or it is not shown; never a straight line), the stops keep
   their numbers, the screen may say why (roadState: « Route en cours de calcul… », « Route indisponible pour l'instant »),
   and the map asks again a minute later. A route the planner refused for good is not asked again (« Route impossible à
   tracer »). */
import { useEffect, useState } from 'preact/hooks';
import type { Day } from '../../lib/dates';
import { routeThrough, routeTrip, tripDue, tripRoad, knownLeg, knownTotal, allKnown, neverRouted, routeFailed, departOf, addedTotal, NOTHING, type LatLng, type RoadTotal } from './roads';
import type { Leg } from './assemble';

/** what a truck's route needs: its start, its stops in order */
export interface RoadTruck { from: LatLng | null; stops: { hasPos: boolean; lat: number | null; lng: number | null }[]; legs?: Leg[] }

const RETRY_MS = 61 * 1000;
/** a short pause between two trucks: gentle with the free route planner */
const PAUSE_MS = 350;
const sigOf = (pts: LatLng[]) => pts.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';');

/** the points of a truck's route: its start, then each stop that has a position */
function waypoints(tr: RoadTruck): LatLng[] {
  return [...(tr.from ? [tr.from] : []), ...tr.stops.filter((s) => s.hasPos).map((s) => [s.lat!, s.lng!] as LatLng)];
}
/** each live trip with no road from the server: [the person, the stop] (a trip with the server's road has more points) */
function tripsOf(trucks: RoadTruck[]): LatLng[][] {
  return trucks.flatMap((tr) => (tr.legs || []).filter((l) => l.kind === 'trip' && l.points.length === 2).map((l) => l.points));
}

/** every route to ask for these trucks: each truck's day, and each live trip with no road from the server */
export function routesOf(trucks: RoadTruck[]): LatLng[][] {
  return [...trucks.map(waypoints), ...tripsOf(trucks)].filter((pts) => pts.length >= 2);
}

/** a leg as drawn: the road the server gave (a trip on its way), or the road by the streets once the route planner
    answered (for that day); until then nothing (an empty line is not drawn: markers.ts `drawable`) */
export function roadOf(leg: Leg, day?: Day | null): LatLng[] {
  if (leg.points.length !== 2) return leg.points;
  // a live trip without the server's road: from where the person is now (or along the road found a moment ago)
  if (leg.kind === 'trip') return tripRoad(leg.points[0], leg.points[1]);
  return knownLeg(leg.points[0], leg.points[1], day) || [];
}

/** asks the roads of these trucks for that day (again when their stops change, and every minute while some are missing);
    the number it returns changes when an answer came in (a road, or nobody answered), so the screen draws again */
export function useRoads(trucks: RoadTruck[], day?: Day | null): number {
  const [n, setN] = useState(0);
  const [tick, setTick] = useState(0);
  const days = trucks.map(waypoints).filter((pts) => pts.length >= 2);
  const trips = tripsOf(trucks);
  const depart = departOf(day);
  const sig = `${depart}|${days.map(sigOf).join('|')}#${trips.map(sigOf).join('|')}`;
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let pause: ReturnType<typeof setTimeout> | null = null;
    const wait = (ms: number) => new Promise<void>((res) => { pause = setTimeout(res, ms); });
    void (async () => {
      let missing = false;
      for (const pts of days) {
        if ((allKnown(pts, day) && knownTotal(pts, day)) || neverRouted(pts, day)) continue;
        const r = await routeThrough(pts, undefined, undefined, undefined, day);
        if (!alive) return;
        // a road came, or nobody answered: either way the screen says it (the road, or « indisponible »)
        setN((x) => x + 1);
        if (!r && !neverRouted(pts, day)) missing = true;
        await wait(PAUSE_MS);
        if (!alive) return;
      }
      for (const [from, to] of trips) {
        if (knownLeg(from, to)) continue;
        // the same stop was asked less than a minute ago (the person moved since): the next round asks it
        if (!tripDue(to)) { missing = true; continue; }
        const r = await routeTrip(from, to);
        if (!alive) return;
        setN((x) => x + 1);
        if (!r) missing = true;
        await wait(PAUSE_MS);
        if (!alive) return;
      }
      // a planner that did not answer: try again in a minute (roads.ts waits that long anyway)
      if (missing) retry = setTimeout(() => setTick((x) => x + 1), RETRY_MS);
    })();
    return () => { alive = false; if (retry) clearTimeout(retry); if (pause) clearTimeout(pause); };
  }, [sig, tick]);
  return n;
}

/** the length and time of a truck's whole route by the streets that day, and who measured it, when known */
export function roadTotal(tr: RoadTruck, day?: Day | null): RoadTotal | null {
  const pts = waypoints(tr);
  return pts.length >= 2 ? knownTotal(pts, day) : null;
}

/** where a truck's road stands, for the words beside the map: 'none' nothing to ask (no two points), 'known' drawn,
    'asking' being asked (« Route en cours de calcul… »), 'down' no planner answered (« Route indisponible pour
    l'instant »; it is asked again a minute later, the words stay until the road comes), 'never' it will never be asked
    (more than 25 points, or every planner said « no road » for good: « Route impossible à tracer », no « for now ») */
export type RoadState = 'none' | 'known' | 'asking' | 'down' | 'never';
export function roadState(tr: RoadTruck, day?: Day | null): RoadState {
  const pts = waypoints(tr);
  if (pts.length < 2) return 'none';
  if (allKnown(pts, day) && knownTotal(pts, day)) return 'known';
  if (neverRouted(pts, day)) return 'never';
  if (routeFailed(pts, day)) return 'down';
  return 'asking';
}

/** what a new stop adds to a vehicle's day by the streets: its route WITH the stop minus its route WITHOUT it (a day with
    no other stop: its whole route), only when the same planner measured both for the same day (TomTom's time with the
    traffic and OSRM's time + 20 % are never subtracted from each other, their roads differ too); null while either is not
    known or they were measured by different planners: say nothing then */
export function roadAdded(withIt: RoadTruck | null | undefined, without: RoadTruck | null | undefined, day?: Day | null): RoadTotal | null {
  const a = withIt ? roadTotal(withIt, day) : null;
  if (!a) return null;
  const b = without && waypoints(without).length >= 2 ? roadTotal(without, day) : NOTHING;
  return addedTotal(a, b);
}
