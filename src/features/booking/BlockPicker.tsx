/* STUB (owner: booking) — choose the day and block: the best suggestions near the address first, then any day. */
import type { BlockKey } from '../../lib/dates';
export interface BlockChoice { day: string; block: BlockKey; truck_id?: string | null }
export interface BlockPickerProps {
  lat: number | null; lng: number | null;
  /** minutes of work (driving is added by the planner) */
  duration: number;
  /** moving a job: leave it out of the counts */
  excludeJob?: string | null;
  value: BlockChoice | null;
  onPick: (c: BlockChoice) => void;
}
export function BlockPicker(_p: BlockPickerProps) { return null; }
