/* Booking: the pure rules behind the form (what is missing, what it costs, what the block picker shows).
   No signals here, so they are easy to test (logic.test.ts). */
import { totals, type Line, type TaxRates, type Totals } from '../../lib/money';
import { isValidDay, duration, type BlockKey, type Day } from '../../lib/dates';
import { t, type Lang } from '../../lib/i18n';
import { blockPhraseLower } from './when';
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

/** a car being typed, in a few words (« 2019 Honda Civic », else its VIN); '' when nothing is typed */
export function carDraftLabel(d: { year: string; make: string; model: string; vin: string }): string {
  return [d.year, d.make, d.model].map((x) => x.trim()).filter(Boolean).join(' ') || d.vin.trim();
}

/* ---------- « garde-route »: a moment that puts too much road in the truck's day ---------- */
/** what the server says of a bookable moment (suggest_blocks); the score is absent with an older server: never far then */
export interface Moment {
  day: string; block: BlockKey;
  add_min?: number; add_km?: number; day_min?: number; hop_min?: number | null; stops?: number; far?: 'hop' | 'day' | null;
}
export interface FarLimits { hop: number; day: number }
/** the moment chosen is far: which one, why, and the warning in plain words */
export interface FarInfo { day: string; block: BlockKey; kind: 'hop' | 'day'; text: string }

export const isFar = (m: Pick<Moment, 'far'> | null | undefined): boolean => m?.far === 'hop' || m?.far === 'day';
/** the two limits of the settings (a settings row saved before them has none: 35 and 105 min) */
export function farLimits(b: { max_hop_min?: number | null; max_day_drive_min?: number | null } | null | undefined): FarLimits {
  return { hop: Number(b?.max_hop_min) || 35, day: Number(b?.max_day_drive_min) || 105 };
}
/** every moment by « day|block »; the first one wins (the server sends the best first) */
export function momentsByKey<M extends Moment>(list: M[]): Map<string, M> {
  const out = new Map<string, M>();
  for (const m of list) { const k = `${m.day}|${m.block}`; if (!out.has(k)) out.set(k, m); }
  return out;
}
/** the moments to offer: never a far one, the first `n` in the server's order */
export function offered<M extends Moment>(list: M[], n = 6): M[] {
  return list.filter((m) => !isFar(m)).slice(0, n);
}
/** why a far moment is far, in plain words; '' when it is fine */
export function farText(m: Moment | null | undefined, lim: FarLimits, l: Lang): string {
  if (!m || !isFar(m)) return '';
  if (m.far === 'hop' && m.hop_min != null) return t('booking.far.hop', { d: duration(m.hop_min, l), max: duration(lim.hop, l) }, l);
  if (m.far === 'day' && m.day_min != null) return t('booking.far.day', { d: duration(m.day_min, l), max: duration(lim.day, l) }, l);
  return t('booking.far.plain', undefined, l);
}
export function farInfo(m: Moment | null | undefined, lim: FarLimits, l: Lang): FarInfo | null {
  return m && isFar(m) ? { day: m.day, block: m.block, kind: m.far as 'hop' | 'day', text: farText(m, lim, l) } : null;
}
/** up to `n` better moments than the far one chosen: the best that are not far, with the minutes of road saved
    (null when it cannot be said, or when nothing is saved) */
export function betterMoments<M extends Moment>(picked: Moment, list: M[], n = 2): { moment: M; saved: number | null }[] {
  return list.filter((m) => !isFar(m) && !(m.day === picked.day && m.block === picked.block)).slice(0, n).map((m) => {
    const saved = picked.add_min != null && m.add_min != null ? Math.round(picked.add_min - m.add_min) : null;
    return { moment: m, saved: saved != null && saved > 0 ? saved : null };
  });
}
/** « Plutôt vendredi 20 novembre, soir : 13 min de route en moins » */
export function betterText(b: { moment: Moment; saved: number | null }, todayDay: Day, l: Lang): string {
  const when = blockPhraseLower(b.moment.day, b.moment.block, todayDay, l);
  return b.saved != null ? t('booking.far.better', { when, d: duration(b.saved, l) }, l) : t('booking.far.betterPlain', { when }, l);
}
/** the question before booking (or moving) into a far moment; null: nothing to ask (not far, or the warning is of
    another moment than the one chosen) */
export function farQuestion(far: FarInfo | null | undefined, choice: { day: string; block: string } | null, mode: 'book' | 'move', l?: Lang): { title: string; text: string; ok: string; cancel: string; danger: true } | null {
  if (!far || !choice || far.day !== choice.day || far.block !== choice.block) return null;
  return { title: t('booking.far.title', undefined, l), text: far.text, ok: t(mode === 'move' ? 'booking.far.okMove' : 'booking.far.ok', undefined, l), cancel: t('booking.far.cancel', undefined, l), danger: true };
}
/** « 13 min de route (4,2 km) » of a suggestion: what the job adds to the whole day when the server says it, else the drive to it */
export function roadWords(m: { drive_min: number; add_min?: number; add_km?: number }, l: Lang): string {
  const min = m.add_min ?? m.drive_min;
  if (min <= 2) return t('booking.picker.noDrive', undefined, l);
  const d = duration(min, l);
  if (m.add_min == null || m.add_km == null) return t('booking.picker.drive', { d }, l);
  return t('booking.picker.driveKm', { d, km: m.add_km.toLocaleString(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }) }, l);
}
