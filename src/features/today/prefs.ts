/* The two choices of « Aujourd'hui » kept on the phone: which day an owner-mechanic looks at, and the route a mechanic
   does now (« Routes partagées »). Per device, not per account (the storage keys are frozen). */
import { signal } from '@preact/signals';
import type { DayView } from './rules';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* private window: kept for this visit only */ }
}

const VIEW_KEY = 'his.dayView';
/** « Vue propriétaire » / « Vue mécano »: anything but 'mechanic' is the team's day */
export const dayView = signal<DayView>(read(VIEW_KEY) === 'mechanic' ? 'mechanic' : 'office');
export function setDayView(v: DayView) {
  dayView.value = v;
  write(VIEW_KEY, v);
}

/** the route this mechanic is doing now, as remembered (routeInUse decides whether it still counts); null: all of them.
    One signal for the whole app (key « his.myRoute »), kept by services/position.ts: the position sent and « Ma journée »
    always read the same choice (R73). */
export { myRoute, setMyRoute } from '../../services/position';
