/* The map of « Vue d'ensemble »: the phone's own copy of the day, with the server's answer (team_map) laid over it.
   The phone's rows say which appointments are today and where each one is (they follow every change at once); the
   server adds what the phone may not hold: where the mechanics are, their trips, other trucks' stops. Pure
   (teamMap.test.ts). Built this way, an appointment booked a moment ago, or re-planned while the network is down, is
   never shown « À placer » for want of a fresh answer. */
import type { TeamMapAnswer } from '../../shared/map/assemble';

/** `elsewhere`: the phone holds that appointment on another day (moved a moment ago): the server's answer, up to 30 s
    old, does not keep it on this day's map */
export function mergeTeamMap(server: TeamMapAnswer | null, device: TeamMapAnswer, elsewhere: (jobId: string) => boolean = () => false): TeamMapAnswer {
  if (!server) return device;
  const fromServer = new Map(server.jobs.map((j) => [j.id, j]));
  const held = new Set(device.jobs.map((j) => j.id));
  const jobs = [
    // the phone's row wins: it is at least as fresh as an answer up to 30 s old (the server's name when the phone has none)
    ...device.jobs.map((d) => { const s = fromServer.get(d.id); return s ? { ...s, ...d, name: d.name && d.name !== '—' ? d.name : s.name } : d; }),
    ...server.jobs.filter((s) => !held.has(s.id) && !elsewhere(s.id))
  ];
  // a truck the server did not list but that holds one of the day's jobs on the phone (else its stops would be lost)
  const trucks = [...server.trucks, ...device.trucks.filter((d) => !server.trucks.some((s) => s.id === d.id) && jobs.some((j) => j.truck_id === d.id))];
  return { home: server.home ?? device.home, trucks, jobs, people: server.people, trips: server.trips };
}

/** the server's answer as the screen keeps it: of which day, and when it came */
export interface ServerMap { day: string; at: number; data: TeamMapAnswer }
/** how long the mechanics' positions and trips of the last answer are still shown when a refresh fails */
export const KEEP_PEOPLE_MS = 90_000;
/** a refresh failed (no signal, slow, refused): the phone's copy for the appointments, always (agenda-05); the
    mechanics' positions and trips of the last answer stay while they are recent (under 90 s), so the map does not
    blink on a weak link; older, or of another day: nothing from the server. `at` stays the time of the real answer. */
export function afterFailure(prev: ServerMap | null, day: string, now: number): ServerMap | null {
  if (!prev || prev.day !== day || now - prev.at >= KEEP_PEOPLE_MS) return null;
  return { ...prev, data: { ...prev.data, jobs: [] } };
}
/** a cheap key of a map: what the screen draws, the trips' routes (long lists of points) by their length and their
    figures only. Two maps with the same key draw the same. */
export function mapKey(a: TeamMapAnswer): string {
  return JSON.stringify({ ...a, trips: a.trips.map((t) => ({ ...t, route: t.route?.length ?? 0 })) });
}
