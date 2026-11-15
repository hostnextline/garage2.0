/* « Plages d'arrivée » in Réglages → Réservations: the small rules of the panel (pure, settings.test.ts). */
import { windowFor, type BlockKey, type Range } from '../../lib/dates';

export interface BlockHours { key: BlockKey; start: number; end: number }
export interface WinNums { before: number | null; after: number | null; round: number | null }
export const WIN_DEFAULTS = { before: 60, after: 180, round: 60 } as const;
export const WIN_LIMITS = { before: [0, 180], after: [30, 360] } as const;
/** « Arrondi »: the windows start on the hour, the half hour or the quarter hour */
export const WIN_ROUNDS = [60, 30, 15] as const;
/** the rounding kept: one of the three choices, else the hour */
export function winRound(v: unknown): number { const n = Number(v); return (WIN_ROUNDS as readonly number[]).includes(n) ? n : WIN_DEFAULTS.round; }

/** first start → last end of the stored blocks */
export function spanOf(blocks: BlockHours[]): Range {
  return [Math.min(...blocks.map((b) => b.start)), Math.max(...blocks.map((b) => b.end))];
}
/** « Heures de la journée »: the stored blocks with a new first start / last end. The cuts between the blocks stay where
    they are when they still fit; else the day is cut again in equal parts (on the quarter hour). */
export function withDaySpan(blocks: BlockHours[], start: number, end: number): BlockHours[] {
  if (!blocks.length || end <= start) return blocks;
  const n = blocks.length;
  const kept = blocks.map((b, i) => ({ ...b, start: i === 0 ? start : b.start, end: i === n - 1 ? end : b.end }));
  if (kept.every((b, i) => b.end > b.start && (i === 0 || b.start >= kept[i - 1].end))) return kept;
  const cut = (i: number) => (i === 0 ? start : i === n ? end : Math.round((start + ((end - start) * i) / n) / 15) * 15);
  return blocks.map((b, i) => ({ ...b, start: cut(i), end: cut(i + 1) }));
}
/** the window told for an estimated arrival, with the numbers being typed (the defaults when one is missing or wrong) */
export function exampleWindow(eta: number, w: WinNums, span: Range): Range {
  const ok = (v: number | null, d: number) => (v != null && Number.isFinite(v) && v >= 0 ? v : d);
  return windowFor(eta, { before: ok(w.before, WIN_DEFAULTS.before), after: ok(w.after, WIN_DEFAULTS.after), round: winRound(w.round), dayStart: span[0], dayEnd: span[1] });
}
/** the day must be at least as long as one window */
export function spanTooShort(span: Range, w: WinNums): boolean {
  return span[1] - span[0] < (w.before ?? WIN_DEFAULTS.before) + (w.after ?? WIN_DEFAULTS.after);
}
