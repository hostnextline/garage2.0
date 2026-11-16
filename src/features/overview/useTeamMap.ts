/* The day's team map for « Vue d'ensemble »: asked of the server now, every 30 s while the screen is in front, and again
   as soon as it comes back to the front; laid over the phone's copy (teamMap.ts). A failed answer, or an answer of
   another day (the screen left open past midnight), counts for nothing: the phone's copy alone is shown then. */
import { useEffect, useState } from 'preact/hooks';
import { rpcNow } from '../../data/api';
import { normalize, type TeamMapAnswer } from '../../shared/map/assemble';
import { fromDevice } from '../../shared/map/device';
import { mergeTeamMap } from './teamMap';

const REFRESH_MS = 30000;

export function useTeamMap(day: string): TeamMapAnswer {
  const [server, setServer] = useState<{ day: string; data: TeamMapAnswer } | null>(null);
  useEffect(() => {
    let alive = true;
    let asked = 0;
    const load = async () => {
      if (document.hidden) return;
      // an answer that comes after a newer question is dropped (a slow one must not undo a fresh one)
      const mine = ++asked;
      try {
        const data = normalize(await rpcNow<unknown>('team_map', { p_day: day }));
        if (alive && mine === asked) setServer({ day, data });
      } catch {
        // no signal or a refusal: the phone's copy alone, never an old answer that no longer matches it
        if (alive && mine === asked) setServer(null);
      }
    };
    const shown = () => { if (!document.hidden) void load(); };
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', shown);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', shown); };
  }, [day]);
  return mergeTeamMap(server && server.day === day ? server.data : null, fromDevice(day));
}
