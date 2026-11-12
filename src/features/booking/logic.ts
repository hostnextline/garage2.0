/* Booking: the pure rules behind the form (what is missing, what it costs, what the block picker shows).
   No signals here, so they are easy to test (logic.test.ts). */
import { totals, type Line, type TaxRates, type Totals } from '../../lib/money';
import { isValidDay, type BlockKey, type Day } from '../../lib/dates';
import type { Job, Quote, Service, JobItem } from '../../data/types';
import type { ItemInput } from '../../data/api';
import type { ItemDraft } from './ServicePicker';
import type { BlockChoice } from './BlockPicker';

/* ---------- what is still missing before « Réserver » ---------- */
export type Missing = 'customer' | 'work' | 'block' | null;
export interface DraftCore { customerId: string | null; items: ItemDraft[]; problem: string; choice: BlockChoice | null }
/** the first missing piece, in the order of the form (a walk-in has no block) */
export function missingPiece(d: DraftCore, walkIn = false): Missing {
  if (!d.customerId) return 'customer';
  if (!d.items.length && !d.problem.trim()) return 'work';
  if (!walkIn && !d.choice) return 'block';
  return null;
}

/* ---------- what it takes and what it costs ---------- */
/** minutes of work of the chosen lines (services without a duration count 45 min) — same rule as itemsDuration */
export function workMinutes(items: ItemDraft[]): number {
  return items.reduce((n, i) => n + (i.duration_min ?? (i.kind === 'service' ? 45 : 0)) * (i.kind === 'service' ? Math.max(1, i.qty) : 1), 0);
}
export function draftLines(items: ItemDraft[]): Line[] {
  return items.map((i) => ({ qty: Number(i.qty) || 0, unitCents: (i.kind === 'discount' ? -1 : 1) * Math.abs(i.unit_cents), taxable: i.taxable }));
}
export interface BookSummary extends Totals {
  /** minutes the planner books: the lines, or the duration chosen by hand, or 60 when there is nothing to count */
  minutes: number;
  /** some service has no price yet (« Prix à confirmer ») */
  toConfirm: boolean;
}
export function bookSummary(items: ItemDraft[], taxes: TaxRates, opts: { override?: number | null; priceless?: (serviceId: string) => boolean } = {}): BookSummary {
  const tt = totals(draftLines(items), taxes);
  const work = workMinutes(items);
  const minutes = clampDuration(opts.override ?? (work > 0 ? work : 60));
  const toConfirm = items.some((i) => i.service_id != null && !!opts.priceless?.(i.service_id));
  return { ...tt, minutes, toConfirm };
}
/** the planner keeps a job between 15 min and 12 h */
export function clampDuration(m: number): number { return Math.max(15, Math.min(720, Math.round(m / 5) * 5)); }

/** the lines as the server takes them */
export function toItemInputs(items: ItemDraft[]): ItemInput[] {
  return items.map((i) => ({
    ...(i.id ? { id: i.id } : {}),
    kind: i.kind, service_id: i.service_id, item_id: i.item_id ?? null, description: i.description.trim(), qty: Number(i.qty) || 1,
    unit_cents: Math.round(i.unit_cents), taxable: i.taxable, duration_min: i.duration_min, note: i.note ?? null, status: 'planned' as const
  }));
}

/** a service of the price list as a line (in the customer's language) */
export function draftOfService(s: Service, l: 'fr' | 'en'): ItemDraft {
  return {
    kind: 'service', service_id: s.id, item_id: null, description: (l === 'en' && s.name_en) || s.name_fr, qty: 1,
    unit_cents: s.price_cents ?? 0, taxable: s.taxable, duration_min: s.duration_min ?? null, note: null
  };
}
/** the lines of an estimate */
export function draftsFromQuote(q: Pick<Quote, 'items'>): ItemDraft[] {
  return (q.items || []).filter((it) => it && String(it.description || '').trim()).map((it) => ({
    kind: it.kind || (it.service_id ? 'service' : 'labour'), service_id: it.service_id ?? null, item_id: null, description: String(it.description),
    qty: Number(it.qty) || 1, unit_cents: Number(it.unit_cents) || 0, taxable: it.taxable !== false, duration_min: it.duration_min ?? null, note: null
  }));
}

/** a copied appointment's work, as new lines: what was booked, done or accepted (not what was refused, removed or still
    waiting for the customer's answer); the prices and times as they were, ready to change */
export function draftsFromJob(items: Pick<JobItem, 'kind' | 'service_id' | 'item_id' | 'description' | 'qty' | 'unit_cents' | 'taxable' | 'duration_min' | 'status' | 'note' | 'sort'>[]): ItemDraft[] {
  return items
    .filter((it) => ['planned', 'done', 'approved'].includes(it.status) && String(it.description || '').trim())
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((it) => ({ kind: it.kind, service_id: it.service_id ?? null, item_id: it.item_id ?? null, description: String(it.description),
      qty: Number(it.qty) || 1, unit_cents: Number(it.unit_cents) || 0, taxable: it.taxable !== false, duration_min: it.duration_min ?? null, note: it.note ?? null }));
}

/* ---------- the address of the address bar (#/book?day=…&block=…) ---------- */
export function parseChoice(day: string | null, block: string | null): BlockChoice | null {
  if (!day || !isValidDay(day)) return null;
  if (block !== 'am' && block !== 'pm' && block !== 'eve') return null;
  return { day, block };
}

/* ---------- how a block looks in the picker ---------- */
export type CellState = 'ok' | 'tight' | 'full' | 'closed' | 'started';
export interface LoadLike {
  trucks: { truck: { id: string }; cap: number; used: number; left: number; jobs: Pick<Job, 'id' | 'duration_min' | 'travel_min' | 'status'>[] }[];
  open: boolean; started: boolean;
}
/**
 * - started: the block has begun (or the day is past): no booking;
 * - closed: no truck works there;
 * - ok: a truck has room for the work and a drive; tight: room for the work only; full: no room.
 * truckId: only that truck counts; exclude: the job being moved does not take its own room.
 */
export function cellState(load: LoadLike, duration: number, drive: number, opts: { truckId?: string | null; exclude?: string | null; unknownMin?: number } = {}): { state: CellState; left: number } {
  if (load.started) return { state: 'started', left: 0 };
  const lanes = load.trucks.filter((x) => !opts.truckId || x.truck.id === opts.truckId);
  if (!load.open || !lanes.some((x) => x.cap > 0)) return { state: 'closed', left: 0 };
  let left = -Infinity;
  for (const x of lanes) {
    let l = x.left;
    const own = opts.exclude ? x.jobs.find((j) => j.id === opts.exclude && j.status !== 'done') : undefined;
    if (own) l += own.duration_min + (own.travel_min ?? opts.unknownMin ?? 20);
    left = Math.max(left, l);
  }
  if (!Number.isFinite(left)) left = 0;
  const state: CellState = left >= duration + drive ? 'ok' : left >= duration ? 'tight' : 'full';
  return { state, left: Math.max(0, left) };
}

/** a booking refused because of the block: the person should pick another block */
export const BLOCK_REFUSALS = ['block_full', 'block_closed', 'block_started', 'truck_full', 'too_far', 'bad_block'];
export function refusalCode(e: unknown): string {
  const err = e as { hint?: string; code?: string } | null;
  return String(err?.hint || (/^[a-z_]+$/.test(String(err?.code || '')) ? err?.code : '') || '');
}
export type { BlockKey, Day };

/* ---------- the car or the truck (Part 24 terdecies) ---------- */
/** words that say the tire machine: montage, pneus non montés, balancement (the same rule as the server, words_need_machine) */
export const wordsNeedMachine = (text: string | null | undefined): boolean => /(montage|non[ -]mont|balanc|mounting|unmounted|not mounted)/i.test(text || '');
/** one of the lines needs the tire machine (its service is marked so, or its words say it): only the truck can take the job */
export function needsMachine(items: { service_id?: string | null; description: string }[], serviceNeeds: (id: string) => boolean): boolean {
  return items.some((i) => wordsNeedMachine(i.description) || (!!i.service_id && serviceNeeds(i.service_id)));
}
