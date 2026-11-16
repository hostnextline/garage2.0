/* A booked job being dragged on the agenda (the block table of the week, and the time grids): which job, the place
   under the pointer, and why that place refuses it (said when the job is let go there).
   The place under the pointer is a signal: only the pieces that draw it (a ghost, a cell's « Déposer ici ») redraw
   while the pointer moves, not the whole grid. */
import { useRef, useState } from 'preact/hooks';
import { signal, type Signal } from '@preact/signals';
import type { Job } from '../../data/types';
import { t } from '../../lib/i18n';
import { may } from '../../domain/rights';
import { toast } from '../../ui';
import type { DropRefusal } from './layout';
import { movesWaiting } from './move';

export type Refusal = DropRefusal | 'past';
/** the place under the pointer: a cell, a day's top, or a unit of a column (`minute`) */
export interface Over { key: string; minute: number; ok: boolean }

export interface Drag {
  job: Job | null;
  over: Signal<Over | null>;
  /** the pointer is on a place: what it is, and why it refuses the job (null: it takes it) */
  hover: (o: Over, why: Refusal, whole: boolean) => void;
  /** the pointer left a place: it no longer speaks (let go outside the grid: no toast of the last place crossed) */
  leave: (key: string) => void;
  start: (j: Job, e: DragEvent) => void;
  /** the drag ended without a drop on a good place: says why the place it ended on refuses the job */
  end: () => void;
  /** the job was let go on a good place: forgets the drag, gives the job */
  take: () => Job | null;
}

/** the drag's functions, made once per grid (the memoised columns and blocks keep them); `setJob` tells the grid which
    job is dragged (it redraws then), `say` speaks a refusal */
export function makeDrag(setJob: (j: Job | null) => void, say: (words: string) => void = (w) => toast(w)): Omit<Drag, 'job'> {
  const over = signal<Over | null>(null);
  let dragged: Job | null = null;
  let refused: { why: Refusal; whole: boolean } | null = null;
  const clear = () => { refused = null; dragged = null; setJob(null); over.value = null; };
  return {
    over,
    hover: (o, why, whole) => {
      refused = why && why !== 'same' ? { why, whole } : null;
      const cur = over.peek();
      if (!cur || cur.key !== o.key || cur.minute !== o.minute || cur.ok !== o.ok) over.value = o;
    },
    leave: (key) => {
      refused = null;
      if (over.peek()?.key === key) over.value = null;
    },
    start: (j, e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', j.id);
      dragged = j;
      // let the browser take the picture of the job before the grid changes
      setTimeout(() => { if (dragged === j) setJob(j); }, 0);
    },
    end: () => {
      const r = refused;
      clear();
      if (!r) return;
      if (r.why === 'started') say(t(r.whole ? 'agenda.move.startedDay' : 'agenda.move.started'));
      else if (r.why === 'closed') say(t(r.whole ? 'agenda.move.closedDay' : 'agenda.move.closed'));
      else if (r.why === 'not_booked') say(t('agenda.move.notBooked'));
      else if (r.why === 'past') say(t('agenda.move.pastTime'));
    },
    take: () => { const j = dragged; clear(); return j; }
  };
}

export function useGridDrag(): Drag {
  const [job, setJob] = useState<Job | null>(null);
  const fns = useRef<Omit<Drag, 'job'> | null>(null);
  if (!fns.current) fns.current = makeDrag(setJob);
  return { job, ...fns.current };
}

/** a job this person may drag: booked, with the right to book, and no move of it still waiting on the phone */
export const canDragJob = (j: Job) => may.book() && j.status === 'booked' && !movesWaiting.value.has(j.id);

/** the pointer left the element for good (not just for one of its children) */
export function leftFor(e: DragEvent): boolean {
  return !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node);
}
