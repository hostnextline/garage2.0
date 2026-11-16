/* « Départ et heure »: the day's hours with a new start time, and the start times offered. Pure (truckDay.test.ts). */
import type { Range } from '../../lib/dates';

const DAY_END = 20 * 60;
/** the day's hours with a new start: what ends before it goes, the first part left starts then; no hours: start → 20 h */
export function withStart(rs: Range[], start: number): Range[] {
  const left = rs.filter(([, e]) => e > start).map(([s, e]) => [s, e] as Range);
  if (!left.length) return [[start, Math.max(start + 60, DAY_END)]];
  left[0] = [start, left[0][1]];
  return left;
}
/** the start times offered: 5 h to 19 h, every half hour (a vehicle that works only the evening starts after 14 h), and the
    vehicle's own start that day when it is not on a half hour, so the list never shows an empty choice */
export function startTimes(current: number | null): number[] {
  const all = Array.from({ length: 29 }, (_, i) => 300 + i * 30);
  return current != null && !all.includes(current) ? [...all, current].sort((a, b) => a - b) : all;
}
