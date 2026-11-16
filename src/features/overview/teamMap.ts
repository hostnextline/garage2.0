/* The map of « Vue d'ensemble »: the phone's own copy of the day, with the server's answer (team_map) laid over it.
   The phone's rows say which appointments are today and where each one is (they follow every change at once); the
   server adds what the phone may not hold: where the mechanics are, their trips, other trucks' stops. Pure
   (teamMap.test.ts). Built this way, an appointment booked a moment ago, or re-planned while the network is down, is
   never shown « À placer » for want of a fresh answer. */
import type { TeamMapAnswer } from '../../shared/map/assemble';

export function mergeTeamMap(server: TeamMapAnswer | null, device: TeamMapAnswer): TeamMapAnswer {
  if (!server) return device;
  const fromServer = new Map(server.jobs.map((j) => [j.id, j]));
  const held = new Set(device.jobs.map((j) => j.id));
  const jobs = [
    // the phone's row wins: it is at least as fresh as an answer up to 30 s old (the server's name when the phone has none)
    ...device.jobs.map((d) => { const s = fromServer.get(d.id); return s ? { ...s, ...d, name: d.name && d.name !== '—' ? d.name : s.name } : d; }),
    ...server.jobs.filter((s) => !held.has(s.id))
  ];
  // a truck the server did not list but that holds one of the day's jobs on the phone (else its stops would be lost)
  const trucks = [...server.trucks, ...device.trucks.filter((d) => !server.trucks.some((s) => s.id === d.id) && jobs.some((j) => j.truck_id === d.id))];
  return { home: server.home ?? device.home, trucks, jobs, people: server.people, trips: server.trips };
}
