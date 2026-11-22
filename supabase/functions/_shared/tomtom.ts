// TomTom on the server: the road and the arrival time of « Je pars » (and « Je pars vers la Centrale ») with the traffic
// of now. Used only when the function has the secret TOMTOM_KEY (TomTom's SERVER key, never the browser one); without it,
// or when TomTom does not answer, enroute keeps OSRM as before. Pure (tested in src/shared/map/server-road.test.ts).

export interface RoadPt { lat: number; lng: number }
export interface Road { km: number; minutes: number; line: [number, number][]; source: string }

export function tomtomRouteUrl(base: string, a: RoadPt, b: RoadPt, key: string): string {
  return `${base}/routing/1/calculateRoute/${a.lat},${a.lng}:${b.lat},${b.lng}/json?key=${encodeURIComponent(key)}`
    + '&traffic=true&travelMode=car&routeType=fastest&departAt=now&routeRepresentation=polyline&computeTravelTimeFor=none';
}

/** at most `max` points of the line (the customer's map draws it), the first and the last always kept */
export function thin(line: [number, number][], max = 250): [number, number][] {
  if (line.length <= max) return line;
  const step = Math.ceil(line.length / max);
  return line.filter((_, i) => i % step === 0 || i === line.length - 1);
}

/** TomTom's answer → the road: km, minutes (the traffic is already in TomTom's time: no margin added), the line;
    null when it is not a route */
export function readTomtomRoad(d: unknown): Road | null {
  const rt = (d as { routes?: { summary?: { lengthInMeters?: number; travelTimeInSeconds?: number }; legs?: { points?: { latitude?: number; longitude?: number }[] }[] }[] } | null)?.routes?.[0];
  const metres = Number(rt?.summary?.lengthInMeters), seconds = Number(rt?.summary?.travelTimeInSeconds);
  if (!rt || !Number.isFinite(metres) || !Number.isFinite(seconds)) return null;
  const line: [number, number][] = [];
  for (const leg of rt.legs || []) {
    for (const p of leg.points || []) {
      const lat = Number(p.latitude), lng = Number(p.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) line.push([Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]);
    }
  }
  return { km: Math.round(metres / 100) / 10, minutes: Math.max(1, Math.round(seconds / 60)), line: thin(line), source: 'tomtom' };
}

// ---------- TomTom's Matrix service (the function « drive »: the planner's road times) ----------
// One request asks the times between a list of origins and a list of destinations at once (« synchronous »: at most 100
// cells, the answer comes in the same request). The traffic is TomTom's usual traffic for that day of the week and that hour
// (« historical »), at a date given WITHOUT an offset: TomTom reads it as the local time of the origin (Montréal's), so the
// change of hour in March and November is TomTom's business, not ours. TomTom answers HTTP 200 even when some cells failed:
// each cell says it (detailedError).

/** the address of a Matrix request: the server key goes in the address, as TomTom asks */
export function tomtomMatrixUrl(base: string, key: string): string {
  return `${base}/routing/matrix/2?key=${encodeURIComponent(key)}`;
}
/** the body of a Matrix request: those origins × those destinations, leaving at `departAt` (YYYY-MM-DDTHH:MM:SS, no offset) */
export function tomtomMatrixBody(origins: RoadPt[], destinations: RoadPt[], departAt: string): Record<string, unknown> {
  const pt = (p: RoadPt) => ({ point: { latitude: p.lat, longitude: p.lng } });
  return { origins: origins.map(pt), destinations: destinations.map(pt),
    options: { departAt, traffic: 'historical', routeType: 'fastest', travelMode: 'car' } };
}
/** one cell of TomTom's answer: the time and the km of the road (minutes rounded UP: never less than TomTom said; the traffic
    is already in TomTom's time, so no margin), or « no road » (TomTom found none: an address put at a wrong place, an
    island), or nothing usable (any other error: asked again later) */
export type MatrixCell = { minutes: number; km: number } | 'no_road' | null;
export const NO_ROAD_CODES = ['NO_ROUTE_FOUND', 'MAP_MATCHING_FAILURE'];
/** TomTom's answer → a cell per « origin index:destination index »; a cell TomTom did not give is absent */
export function readTomtomMatrix(d: unknown): Map<string, MatrixCell> {
  const out = new Map<string, MatrixCell>();
  const data = (d as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return out;
  for (const x of data as { originIndex?: number; destinationIndex?: number; routeSummary?: { lengthInMeters?: number; travelTimeInSeconds?: number }; detailedError?: { code?: string } }[]) {
    if (!x || !Number.isInteger(x.originIndex) || !Number.isInteger(x.destinationIndex)) continue;
    const at = `${x.originIndex}:${x.destinationIndex}`;
    const m = Number(x.routeSummary?.lengthInMeters), s = Number(x.routeSummary?.travelTimeInSeconds);
    if (x.routeSummary && Number.isFinite(m) && Number.isFinite(s) && m >= 0 && s >= 0) out.set(at, { minutes: Math.ceil(s / 60), km: Math.round(m / 100) / 10 });
    else if (NO_ROAD_CODES.includes(String(x.detailedError?.code || ''))) out.set(at, 'no_road');
    else out.set(at, null);
  }
  return out;
}
