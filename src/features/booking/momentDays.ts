/* « Choisir sur la carte » (MomentMap.tsx): the pure rules of the day strip, of the block highlighted by default and of
   the pins of the overview. No signals here (momentDays.test.ts). */
import type { BlockKey } from '../../lib/dates';
import { isFar, type CellState, type Moment } from './logic';

/** a block of a day as the calendar shows it (cellState) */
export interface DayCell { key: BlockKey; state: CellState; left?: number }
export interface DayRow { day: string; blocks: DayCell[] }
/** a block where a booking goes in without forcing: room left, not closed, not started */
export const isOpen = (c: Pick<DayCell, 'state'>): boolean => c.state === 'ok' || c.state === 'tight';

export interface DayChip {
  day: string;
  /** the appointments already that day */
  jobs: number;
  /** some block is open: the day can be chosen */
  open: boolean;
  /** why not, when no block is open: every block full, else closed (or passed) */
  shut: 'full' | 'closed' | null;
  /** what the best moment of the day that is not far adds to the route (the server's score), when it is said */
  add: number | null;
  /** every open moment of that day the server scored is far from the other stops */
  far: boolean;
  /** the day of the server's best moment */
  best: boolean;
}
/** the day strip: for each day of the page, what there is already and what the server says of its open moments
    (`list` in the server's order: the best first) */
export function dayChips(rows: DayRow[], list: Moment[], counts: Record<string, number>): DayChip[] {
  const openKey = new Set(rows.flatMap((r) => r.blocks.filter(isOpen).map((c) => `${r.day}|${c.key}`)));
  const scored = list.filter((m) => openKey.has(`${m.day}|${m.block}`));
  const bestDay = scored.find((m) => !isFar(m))?.day ?? null;
  return rows.map((r) => {
    const open = r.blocks.some(isOpen);
    const mine = scored.filter((m) => m.day === r.day);
    const adds = mine.filter((m) => !isFar(m) && m.add_min != null).map((m) => m.add_min as number);
    return {
      day: r.day, jobs: counts[r.day] || 0, open,
      shut: open ? null : r.blocks.some((c) => c.state === 'full') ? 'full' : 'closed',
      add: adds.length ? Math.min(...adds) : null,
      far: mine.length > 0 && mine.every(isFar),
      best: open && r.day === bestDay
    };
  });
}

/** the block shown first when a day is chosen: the best open block of that day by the server's order, else the first
    open one; null when no block is open */
export function defaultBlock(blocks: DayCell[], day: string, list: Moment[]): BlockKey | null {
  const open = blocks.filter(isOpen).map((c) => c.key);
  const scored = list.find((m) => m.day === day && open.includes(m.block));
  return scored?.block ?? open[0] ?? null;
}

/* ---------- the overview: every coming appointment around the new address ---------- */
export interface PinJob { id: string; day: string; block: string; status: string; truck_id: string | null; lat?: number | null; lng?: number | null }
export interface Pin { id: string; day: string; block: string; truckId: string | null; lat: number; lng: number }
const GONE = ['cancelled', 'no_show', 'done'];
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** the appointments still to come on these days (not cancelled, not missed, not done), the one being moved left out */
export function comingJobs<J extends PinJob>(jobs: J[], days: string[], exclude?: string | null): J[] {
  return jobs.filter((j) => days.includes(j.day) && !GONE.includes(j.status) && j.id !== exclude);
}
/** how many of them each day */
export function dayCounts(jobs: PinJob[], days: string[], exclude?: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of comingJobs(jobs, days, exclude)) out[j.day] = (out[j.day] || 0) + 1;
  return out;
}
/** their pins: only those with a position (the appointment's own, else `posOf`: the customer's), by day then block */
export function overviewPins<J extends PinJob>(jobs: J[], days: string[], opts: { exclude?: string | null; posOf?: (j: J) => { lat?: number | null; lng?: number | null } | null | undefined } = {}): Pin[] {
  const order: Record<string, number> = { am: 0, pm: 1, eve: 2 };
  const out: Pin[] = [];
  for (const j of comingJobs(jobs, days, opts.exclude)) {
    const at = num(j.lat) && num(j.lng) ? { lat: j.lat, lng: j.lng } : opts.posOf?.(j);
    if (!at || !num(at.lat) || !num(at.lng)) continue;
    out.push({ id: j.id, day: j.day, block: j.block, truckId: j.truck_id, lat: at.lat, lng: at.lng });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (order[a.block] ?? 9) - (order[b.block] ?? 9) || a.id.localeCompare(b.id));
}
