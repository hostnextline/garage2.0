/* Where the small map windows go on a computer, beside what the mouse is on, always inside the screen. Pure (the box
   on screen and the screen's size are passed in), tested in place.test.ts. Three windows, three sizes:
   - the time grid's unit (360 × 420, beside its column: left first);
   - a best moment of windows mode (360 × 330, beside the row: left first);
   - the blocks picker's moments and « Tous les jours » (340 × 352, beside: right first, else above or under). */

/** a floating box: hugging the left or the right of the screen, and its top */
export interface FloatAt { left?: number; right?: number; top: number;
  /** the words above the map (else the moment's own words) */
  title?: string }
export interface Rect { left: number; right: number; top: number; bottom: number }

/** where a floating box goes, as a style */
export const floatStyle = (f: FloatAt) => ({ top: `${f.top}px`, ...(f.right != null ? { right: `${f.right}px` } : { left: `${f.left ?? 8}px` }) });

const GRID_W = 360, GRID_H = 420;
/** the time grid: beside the column (its left when there is room, else its right), never over the unit pointed at */
export function floatPlace(unit: { top: number; bottom: number }, col: { left: number; right: number }, vw: number, vh: number, h = GRID_H): FloatAt {
  const top = Math.max(8, Math.min(vh - h - 8, unit.top - 10));
  if (col.left - GRID_W - 12 >= 8) return { right: vw - col.left + 12, top };
  if (col.right + 12 + GRID_W <= vw - 8) return { left: col.right + 12, top };
  // no room beside: under the unit, else above it
  return { left: Math.max(8, Math.min(vw - GRID_W - 8, col.left)), top: unit.bottom + 12 + h <= vh ? unit.bottom + 12 : Math.max(8, unit.top - h - 12) };
}

const ROW_W = 360, ROW_H = 330;
/** a best moment of windows mode: on its left when there is room, else on its right; kept inside the screen */
export function besideRow(r: Rect, vw: number, vh: number): { left: number; top: number } {
  const left = r.left - ROW_W - 12 >= 8 ? r.left - ROW_W - 12 : Math.min(vw - ROW_W - 8, r.right + 12);
  const top = Math.max(8, Math.min(vh - ROW_H - 8, r.top - 40));
  return { left, top };
}

export const HOVER_W = 340;
const HOVER_H = 352, GAP = 12;
/** the blocks picker's window: beside it (right, else left), else above or under it */
export function hoverBox(at: Rect, vw: number, vh: number): { left: number; top: number } {
  const side = at.right + GAP + HOVER_W <= vw - 8 ? at.right + GAP : at.left - GAP - HOVER_W >= 8 ? at.left - GAP - HOVER_W : null;
  const left = side ?? Math.max(8, Math.min(vw - HOVER_W - 8, at.left));
  const top = side != null ? Math.max(8, Math.min(vh - HOVER_H - 8, (at.top + at.bottom) / 2 - HOVER_H / 2))
    : at.top - GAP - HOVER_H >= 8 ? at.top - GAP - HOVER_H : Math.min(vh - HOVER_H - 8, at.bottom + GAP);
  return { left, top };
}
