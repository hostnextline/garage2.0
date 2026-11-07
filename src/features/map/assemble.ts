/* The team map, from the answer of team_map(p_day) (or the same shape built from the phone's copy):
   for each truck its numbered stops in stop order (matin, après-midi, soir), the route from the Centrale through the
   stops (straight lines; the active trip's real route when there is one), the live positions of the people.
   Pure functions: no screen, no server (tested in assemble.test.ts). */

export type LatLng = [number, number];
export interface TeamMapAnswer {
  home: { lat: number | null; lng: number | null; label?: string | null; address?: string | null } | null;
  /** start: where this truck leaves from (Part 18); null = « Départ des camions » (home) */
  trucks: { id: string; name: string; color: string | null; driver_id: string | null; start?: { lat: number; lng: number; label: string | null; address: string | null } | null }[];
  jobs: { id: string; number: number | null; truck_id: string | null; order: number | null; eta_min: number | null; status: string; block: string; name: string | null; address: string | null; lat: number | null; lng: number | null }[];
  people: { id: string; name: string | null; color: string | null; lat: number; lng: number; at: string | null; job_id: string | null }[];
  trips: { job_id: string; staff_id: string | null; eta_at: string | null; km: number | null; minutes: number | null; route: LatLng[] | null }[];
}

export interface Stop {
  id: string; number: number | null; truckId: string | null;
  /** the stop number of the day for its truck (1, 2, 3…) */
  n: number;
  block: string; order: number | null; etaMin: number | null; status: string; name: string; address: string;
  lat: number | null; lng: number | null; hasPos: boolean;
  done: boolean;
  /** the mechanic is on the way or there */
  live: boolean;
}
export interface Leg { points: LatLng[]; kind: 'done' | 'todo' | 'trip' }
export interface TripInfo { jobId: string; staffId: string | null; etaAt: string | null; minutes: number | null; km: number | null; route: LatLng[]; dest: LatLng | null }
export interface TruckRoute {
  id: string; name: string; color: string; driverId: string | null; driverName: string;
  stops: Stop[]; done: number; total: number;
  /** the first stop not done yet */
  next: Stop | null;
  /** when it should get there (minutes after midnight): the trip's estimate when on the way, else the plan */
  nextEta: number | null;
  trip: TripInfo | null;
  legs: Leg[];
  /** where its route starts (its own start, else « Départ des camions ») */
  from: LatLng | null;
  /** its own start, when it has one */
  start: { lat: number; lng: number; label: string; address: string } | null;
}
export interface Person {
  id: string; name: string; color: string; lat: number; lng: number; at: string | null; jobId: string | null; truckId: string | null;
  /** working at a customer's (on site): shown there, whatever the age of the last position (the phone sleeps while he works) */
  onSite: { jobId: string; name: string } | null;
}
export interface Assembled {
  home: { lat: number; lng: number; label: string; address: string } | null;
  trucks: TruckRoute[];
  /** jobs of the day not placed on a truck (or on a truck that no longer exists) */
  unplaced: Stop[];
  people: Person[];
  trips: TripInfo[];
  /** every stop of the day */
  count: number;
}

export const PALETTE = ['#D3000E', '#2F6FD0', '#1F8A53', '#B86E00', '#7347D1', '#0F7C82', '#C2185B', '#5D6B78'];
export const UNPLACED_COLOR = '#5D6B78';
const BLOCK_ORDER: Record<string, number> = { am: 0, pm: 1, eve: 2 };

const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const okLat = (x: number | null): x is number => x != null && Math.abs(x) <= 90;
const okLng = (x: number | null): x is number => x != null && Math.abs(x) <= 180;
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
function cleanRoute(r: unknown): LatLng[] {
  return arr<unknown>(r).map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [null, null]))
    .filter((p): p is LatLng => okLat(p[0]) && okLng(p[1]));
}

/** reads any answer safely (a field missing, a number sent as text…): never throws */
export function normalize(raw: unknown): TeamMapAnswer {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const h = (a.home && typeof a.home === 'object' ? a.home : null) as Record<string, unknown> | null;
  return {
    home: h ? { lat: num(h.lat), lng: num(h.lng), label: h.label == null ? null : String(h.label), address: h.address == null ? null : String(h.address) } : null,
    trucks: arr<Record<string, unknown>>(a.trucks).filter((t) => t && t.id != null).map((t) => {
      const st = (t.start && typeof t.start === 'object' ? t.start : null) as Record<string, unknown> | null;
      const sl = st ? num(st.lat) : null, sg = st ? num(st.lng) : null;
      return {
        id: String(t.id), name: String(t.name ?? ''), color: t.color ? String(t.color) : null, driver_id: t.driver_id ? String(t.driver_id) : null,
        start: st && okLat(sl) && okLng(sg) ? { lat: sl, lng: sg, label: st.label == null ? null : String(st.label), address: st.address == null ? null : String(st.address) } : null
      };
    }),
    jobs: arr<Record<string, unknown>>(a.jobs).filter((j) => j && j.id != null).map((j) => ({
      id: String(j.id), number: num(j.number), truck_id: j.truck_id ? String(j.truck_id) : null, order: num(j.order), eta_min: num(j.eta_min),
      status: String(j.status ?? 'booked'), block: String(j.block ?? 'am'), name: j.name == null ? null : String(j.name), address: j.address == null ? null : String(j.address),
      lat: num(j.lat), lng: num(j.lng)
    })),
    people: arr<Record<string, unknown>>(a.people).filter((p) => p && p.id != null && okLat(num(p.lat)) && okLng(num(p.lng))).map((p) => ({
      id: String(p.id), name: p.name == null ? null : String(p.name), color: p.color ? String(p.color) : null, lat: num(p.lat)!, lng: num(p.lng)!,
      at: p.at ? String(p.at) : null, job_id: p.job_id ? String(p.job_id) : null
    })),
    trips: arr<Record<string, unknown>>(a.trips).filter((t) => t && t.job_id != null).map((t) => ({
      job_id: String(t.job_id), staff_id: t.staff_id ? String(t.staff_id) : null, eta_at: t.eta_at ? String(t.eta_at) : null,
      km: num(t.km), minutes: num(t.minutes), route: cleanRoute(t.route)
    }))
  };
}

/** minutes after midnight (the phone's clock, Montréal) of a moment */
export function minuteOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes();
}

function sortStops<T extends { block: string; order: number | null; etaMin: number | null; number: number | null }>(list: T[]): T[] {
  return list.slice().sort((a, b) =>
    ((BLOCK_ORDER[a.block] ?? 9) - (BLOCK_ORDER[b.block] ?? 9))
    || ((a.order ?? 999) - (b.order ?? 999))
    || ((a.etaMin ?? 9999) - (b.etaMin ?? 9999))
    || ((a.number ?? 0) - (b.number ?? 0)));
}
const near = (a: LatLng, b: LatLng) => Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;

export interface AssembleOptions {
  /** the name of a person (staff), to name the driver of a truck */
  nameOf?: (staffId: string) => string;
}

export function assemble(raw: TeamMapAnswer | unknown, opts: AssembleOptions = {}): Assembled {
  const a = normalize(raw);
  const nameOf = opts.nameOf || (() => '');
  const home = a.home && okLat(a.home.lat) && okLng(a.home.lng)
    ? { lat: a.home.lat, lng: a.home.lng, label: a.home.label || 'Centrale', address: a.home.address || '' } : null;
  const homePt: LatLng | null = home ? [home.lat, home.lng] : null;

  const trips: TripInfo[] = a.trips.map((t) => {
    const j = a.jobs.find((x) => x.id === t.job_id);
    const dest: LatLng | null = j && okLat(j.lat) && okLng(j.lng) ? [j.lat, j.lng] : (t.route?.length ? t.route[t.route.length - 1] : null);
    return { jobId: t.job_id, staffId: t.staff_id, etaAt: t.eta_at, minutes: t.minutes, km: t.km, route: t.route || [], dest };
  });

  const toStop = (j: TeamMapAnswer['jobs'][number]): Omit<Stop, 'n'> => ({
    id: j.id, number: j.number, truckId: j.truck_id, block: j.block, order: j.order, etaMin: j.eta_min, status: j.status,
    name: j.name || '', address: j.address || '', lat: okLat(j.lat) ? j.lat : null, lng: okLng(j.lng) ? j.lng : null,
    hasPos: okLat(j.lat) && okLng(j.lng), done: j.status === 'done', live: j.status === 'en_route' || j.status === 'on_site'
  });
  const truckIds = new Set(a.trucks.map((t) => t.id));
  const peopleOn = new Set(a.people.map((p) => p.id));

  const trucks: TruckRoute[] = [];
  a.trucks.forEach((t, i) => {
    const color = t.color || PALETTE[i % PALETTE.length];
    const stops: Stop[] = sortStops(a.jobs.filter((j) => j.truck_id === t.id).map(toStop)).map((s, k) => ({ ...s, n: k + 1 }));
    const driverLive = !!t.driver_id && peopleOn.has(t.driver_id);
    const myTrips = trips.filter((tr) => stops.some((s) => s.id === tr.jobId && !s.done));
    if (!stops.length && !driverLive && !myTrips.length) return;   // a truck with nothing to show that day
    const next = stops.find((s) => !s.done) || null;
    const trip = (next && myTrips.find((tr) => tr.jobId === next.id)) || myTrips[0] || null;
    const driverPerson = t.driver_id ? a.people.find((p) => p.id === t.driver_id) : undefined;
    const legs: Leg[] = [];
    const start = t.start ? { lat: t.start.lat, lng: t.start.lng, label: t.start.label || '', address: t.start.address || '' } : null;
    const from: LatLng | null = start ? [start.lat, start.lng] : homePt;
    let prev: LatLng | null = from;
    for (const s of stops) {
      if (!s.hasPos) continue;
      const to: LatLng = [s.lat!, s.lng!];
      const tr = !s.done ? myTrips.find((x) => x.jobId === s.id) : undefined;
      if (tr) {
        let pts: LatLng[] = tr.route.length >= 2 ? tr.route.slice() : [];
        if (!pts.length) {
          const from: LatLng | null = driverPerson ? [driverPerson.lat, driverPerson.lng] : prev;
          pts = from ? [from, to] : [];
        }
        if (pts.length && !near(pts[pts.length - 1], to)) pts.push(to);
        if (pts.length >= 2) legs.push({ points: pts, kind: 'trip' });
      } else if (prev) {
        legs.push({ points: [prev, to], kind: s.done ? 'done' : 'todo' });
      }
      prev = to;
    }
    const nextEta = next ? (trip && trip.jobId === next.id ? minuteOf(trip.etaAt) ?? next.etaMin : next.etaMin) : null;
    trucks.push({
      id: t.id, name: t.name, color, driverId: t.driver_id,
      driverName: (t.driver_id && (nameOf(t.driver_id) || driverPerson?.name)) || '',
      stops, done: stops.filter((s) => s.done).length, total: stops.length, next, nextEta, trip, legs, from, start
    });
  });

  const unplaced: Stop[] = sortStops(a.jobs.filter((j) => !j.truck_id || !truckIds.has(j.truck_id)).map(toStop)).map((s, k) => ({ ...s, n: k + 1 }));

  const people: Person[] = a.people.map((p, i) => {
    const tr = a.trucks.find((t) => t.driver_id === p.id) || (p.job_id ? a.trucks.find((t) => a.jobs.some((j) => j.id === p.job_id && j.truck_id === t.id)) : undefined);
    const truckColor = tr ? (trucks.find((x) => x.id === tr.id)?.color || tr.color) : null;
    // on site: the job he is working at (his position's job, else his truck's job on site), and he is shown at that address
    const site = a.jobs.find((j) => j.status === 'on_site' && (j.id === p.job_id || (!!tr && j.truck_id === tr.id)));
    const at = site && okLat(site.lat) && okLng(site.lng) ? { lat: site.lat as number, lng: site.lng as number } : { lat: p.lat, lng: p.lng };
    return {
      id: p.id, name: p.name || nameOf(p.id) || '', color: p.color || truckColor || PALETTE[(i + 3) % PALETTE.length],
      lat: at.lat, lng: at.lng, at: p.at, jobId: p.job_id, truckId: tr?.id ?? null,
      onSite: site ? { jobId: site.id, name: site.name || '' } : null
    };
  });

  return { home, trucks, unplaced, people, trips, count: a.jobs.length };
}

/** every point worth keeping in view for one truck (its stops, its driver, its trip) */
export function pointsOf(truck: TruckRoute, people: Person[]): LatLng[] {
  const pts: LatLng[] = truck.stops.filter((s) => s.hasPos).map((s) => [s.lat!, s.lng!] as LatLng);
  const p = people.find((x) => x.id === truck.driverId || x.truckId === truck.id);
  if (p) pts.push([p.lat, p.lng]);
  return pts;
}
