/* « Réorganiser la journée » opened IN PLACE (Part 28, REARRANGE.md §2.1): the agenda's day, the Carte, Aujourd'hui, « Ma
   journée », Vue d'ensemble, a stop's menu and the job screen each mount one DayOrderHost; their button calls
   openDayOrder(day, { truck, job, first }) and the one sheet rises over the screen, which stays where it was (the MoveHost
   pattern). Only the first host mounted draws (useHostTurn), so the sheet is never shown twice; when the last host goes
   (the person left for a screen that has none), the request is dropped instead of rising later on another screen.
   `onSaved`: a screen that shows the server's own answer (the Carte's team_map) asks it again after a save. */
import { signal } from '@preact/signals';
import { useHostTurn } from './hosts';
import { mayOrderDay } from '../../domain/jobs/dayOrder';
import { DayOrderSheet, type DayOrderAt } from './DayOrderSheet';

/** the day whose sheet is open (a new seq each time: opened again, it starts again) */
const opened = signal<(DayOrderAt & { seq: number }) | null>(null);
let seq = 0;

/** opens « Réorganiser la journée » on that day, on the screen itself: `truck` shown first, `job` ringed (`first`: put
    first, in the draft, not saved). Nothing when this person may not rearrange that day. */
export function openDayOrder(day: string, o: { truck?: string | null; job?: string; first?: boolean } = {}): void {
  if (!mayOrderDay(day)) return;
  opened.value = { day, truck: o.truck ?? null, job: o.job, first: !!o.first, seq: ++seq };
}
/** the day open now (tests) */
export const dayOrderOpenFor = (): string | null => opened.value?.day ?? null;
/** closes it (tests, sign-out) */
export function closeDayOrder(): void { opened.value = null; }

export function DayOrderHost(p: { onSaved?: () => void }) {
  const mine = useHostTurn('dayOrder', () => { opened.value = null; });
  const at = opened.value;
  if (!mine || !at) return null;
  return <DayOrderSheet key={at.seq} at={at} onClose={() => { if (opened.value?.seq === at.seq) opened.value = null; }} onSaved={p.onSaved} />;
}
