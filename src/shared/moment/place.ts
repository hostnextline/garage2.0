/* Where the windows that follow the mouse go on a computer, always inside the screen. Pure (the boxes on screen and the
   screen's size are passed in), tested in place.test.ts. Two windows:
   - the map of the day (the real map, big enough to read): beside the whole picker when there is room, so it stays in
     place while the mouse goes from a moment to the next; else beside, under or above the moment itself;
   - the words of a time of the grid (a small label beside its column). */

/** a floating box: hugging the left or the right of the screen, and its top */
export interface FloatAt { left?: number; right?: number; top: number;
  /** the words above the map (else the moment's own words) */
  title?: string }
export interface Rect { left: number; right: number; top: number; bottom: number }

/** where a floating box goes, as a style */
export const floatStyle = (f: FloatAt) => ({ top: `${f.top}px`, ...(f.right != null ? { right: `${f.right}px` } : { left: `${f.left ?? 8}px` }) });

const GRID_W = 360, GRID_H = 420;
/** the height kept for the words of a time (one or two lines) */
export const LABEL_H = 64;
/** the time grid: beside the column (its left when there is room, else its right), never over the unit pointed at */
export function floatPlace(unit: { top: number; bottom: number }, col: { left: number; right: number }, vw: number, vh: number, h = GRID_H): FloatAt {
  const top = Math.max(8, Math.min(vh - h - 8, unit.top - 10));
  if (col.left - GRID_W - 12 >= 8) return { right: vw - col.left + 12, top };
  if (col.right + 12 + GRID_W <= vw - 8) return { left: col.right + 12, top };
  // no room beside: under the unit, else above it
  return { left: Math.max(8, Math.min(vw - GRID_W - 8, col.left)), top: unit.bottom + 12 + h <= vh ? unit.bottom + 12 : Math.max(8, unit.top - h - 12) };
}

/* ---------- the map of the day ---------- */
/** the map window: where it is, how wide, how tall its map. `aside`: beside the whole picker (it does not move while the
    mouse goes from a moment to the next); else it is beside, under or above the moment itself */
export interface PopAt { left: number; top: number; width: number; mapH: number; aside: boolean }
/** the sizes of the map window: as big as the screen lets it be, up to a real map (`chrome`: its title, the stops and
    the words under the map, its padding) */
export const POP = { maxW: 640, minW: 400, itemMinW: 360, maxMapH: 460, minMapH: 220, chrome: 150, gap: 12, edge: 8 };

/** `item`: the moment under the mouse; `group`: the whole picker (null: unknown) */
export function popPlace(item: Rect, group: Rect | null, vw: number, vh: number): PopAt {
  const { gap, edge } = POP;
  const tall = (room: number) => Math.max(POP.minMapH, Math.min(POP.maxMapH, room - POP.chrome));
  /** beside a box, on the side that has the most room (the left when both have as much) */
  const beside = (r: Rect, minW: number): { left: number; width: number } | null => {
    const roomL = r.left - gap - edge, roomR = vw - r.right - gap - edge;
    const room = Math.max(roomL, roomR);
    if (room < minW) return null;
    const width = Math.min(POP.maxW, room);
    return { width, left: roomL >= roomR ? r.left - gap - width : r.right + gap };
  };
  const mapH = tall(vh - 2 * edge);
  const inside = (top: number) => Math.max(edge, Math.min(vh - mapH - POP.chrome - edge, top));
  const a = group ? beside(group, POP.minW) : null;
  if (a) return { ...a, top: inside(group!.top), mapH, aside: true };
  const b = beside(item, POP.itemMinW);
  if (b) return { ...b, top: inside((item.top + item.bottom) / 2 - (mapH + POP.chrome) / 2), mapH, aside: false };
  // no room beside: under the moment, else above it (where there is the most room)
  const width = Math.min(POP.maxW, vw - 2 * edge);
  const left = Math.max(edge, Math.min(vw - width - edge, (item.left + item.right) / 2 - width / 2));
  const under = vh - item.bottom - gap - edge, above = item.top - gap - edge;
  const h = tall(Math.max(under, above));
  return { left, width, mapH: h, top: under >= above ? item.bottom + gap : Math.max(edge, item.top - gap - h - POP.chrome), aside: false };
}
