/* The day's team map for « Vue d'ensemble »: asked of the server now, every 30 s while the screen is in front, and again
   as soon as it comes back to the front; laid over the phone's copy (teamMap.ts). A failed answer, or an answer of
   another day (the screen left open past midnight), counts for nothing for the appointments: the phone's copy alone is
   shown then (the mechanics' positions of an answer under 90 s old stay, so the map does not blink: afterFailure).
   The map given back is the same object while what it draws is the same (the screen assembles it once). */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { rpcNow } from '../../data/api';
import { normalize, type TeamMapAnswer } from '../../shared/map/assemble';
import { fromDevice } from '../../shared/map/device';
import { job as jobRow } from '../../data/select';
import { movedLately } from '../../shared/jobs/moving';
import { afterFailure, mapKey, mergeTeamMap, type ServerMap } from './teamMap';

const REFRESH_MS = 30000;

export function useTeamMap(day: string): TeamMapAnswer {
  const [server, setServer] = useState<ServerMap | null>(null);
  useEffect(() => {
    let alive = true;
    let asked = 0;
    const load = async () => {
      if (document.hidden) return;
      // an answer that comes after a newer question is dropped (a slow one must not undo a fresh one)
      const mine = ++asked;
      try {
        const data = normalize(await rpcNow<unknown>('team_map', { p_day: day }));
        if (alive && mine === asked) setServer({ day, at: Date.now(), data });
      } catch {
        // no signal or a refusal: the phone's copy for the appointments, never an old answer that no longer matches it
        if (alive && mine === asked) setServer((prev) => afterFailure(prev, day, Date.now()));
      }
    };
    const shown = () => { if (!document.hidden) void load(); };
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', shown);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', shown); };
  }, [day]);
  const answer = server && server.day === day ? server.data : null;
  const device = fromDevice(day);
  const key = mapKey(device);
  // an appointment moved from this phone a moment ago (« Déplacer » from the list) and now on another day leaves the map
  // at once; any other the phone holds on another day stays where the server says (its copy may be the late one)
  return useMemo(() => mergeTeamMap(answer, device, (id) => { const r = jobRow(id); return !!r && r.day !== day && movedLately(id); }), [answer, key]);
}
