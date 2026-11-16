/* The trucks' routes by the streets, for every map of the day (« Carte », « Aperçu », « Voir sur la carte » of a booking):
   each truck's route (its start, then its stops in order) is asked once from the route planner (roads.ts), one truck at a
   time; a live trip that has no road yet (the mechanic's position → the stop) is asked too. Until the answer comes (or when
   no planner answers) the straight line stays, and the map asks again a minute later. */
import { useEffect, useState } from 'preact/hooks';
import { routeThrough, knownLeg, knownTotal, allKnown, type LatLng } from './roads';
import type { Leg } from './assemble';

/** what a truck's route needs: its start, its stops in order */
export interface RoadTruck { from: LatLng | null; stops: { hasPos: boolean; lat: number | null; lng: number | null }[]; legs?: Leg[] }

/** the points of a truck's route: its start, then each stop that has a position */
export function waypoints(tr: RoadTruck): LatLng[] {
  return [...(tr.from ? [tr.from] : []), ...tr.stops.filter((s) => s.hasPos).map((s) => [s.lat!, s.lng!] as LatLng)];
}

/** a leg as drawn: by the streets once known, else as it is */
export function roadOf(leg: Leg): LatLng[] {
  if (leg.points.length !== 2) return leg.points;
  return knownLeg(leg.points[0], leg.points[1]) || leg.points;
}

/** asks the roads of these trucks (again when their stops change, and every minute while some are missing); the number
    it returns changes when a road came in, so the map draws again */
export function useRoads(trucks: RoadTruck[]): number {
  const [n, setN] = useState(0);
  const [tick, setTick] = useState(0);
  const routes: LatLng[][] = [
    ...trucks.map(waypoints),
    // a live trip with no road from the server: the mechanic's position → the stop
    ...trucks.flatMap((tr) => (tr.legs || []).filter((l) => l.kind === 'trip' && l.points.length === 2).map((l) => l.points))
  ].filter((pts) => pts.length >= 2);
  const sig = routes.map((pts) => pts.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';')).join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      let missing = false;
      for (const pts of routes) {
        if (allKnown(pts) && knownTotal(pts)) continue;
        const r = await routeThrough(pts);
        if (!alive) return;
        if (r) setN((x) => x + 1); else missing = true;
        await new Promise((res) => setTimeout(res, 350));   // gentle with the free route planner
      }
      // a planner that did not answer: try again in a minute (roads.ts waits that long anyway)
      if (missing && alive) setTimeout(() => { if (alive) setTick((x) => x + 1); }, 61 * 1000);
    })();
    return () => { alive = false; };
  }, [sig, tick]);
  return n;
}

/** the length and time of a truck's whole route by the streets, when known */
export function roadTotal(tr: RoadTruck): { km: number; minutes: number } | null {
  const pts = waypoints(tr);
  return pts.length >= 2 ? knownTotal(pts) : null;
}
