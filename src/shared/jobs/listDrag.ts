/* The drag of « Réorganiser la journée » (Part 28, REARRANGE.md §2.3). No package: Pointer Events, the recipe of
   features/hours/HoursGrid.tsx (capture in a try, elementFromPoint for the place under the pointer).
   - A finger or a pen drags by the grip ≡ only (its `touch-action: none`): anywhere else the list keeps scrolling. A mouse
     drags the whole row (the grip and the row's main button; on the main button a click stays a click).
   - Nothing moves before the pointer went 4 px (finger, pen) / 6 px (mouse) from where it went down. Then the row stays as
     its own placeholder (`dragging`), and a ghost — a copy of the row, `position: fixed`, moved by `transform` only —
     follows the pointer. The ghost is put on document.body, never inside the sheet: the sheet's glass (`backdrop-filter`,
     `transform`) makes it the containing block of a fixed child, which would sit away from the finger (code F8).
   - The place under the pointer (`target`): a row (before it when above its middle, else after), the rows under way (the
     first free place after them), an end slot or a truck's head (the end of that truck), a truck chip held 400 ms (the
     list scrolls to that truck and the drag goes on; let go on it: its end). A place the stop may not go keeps the truck
     and the reason, and draws no line. Only the ghost and `target` change while dragging: no server call.
   - Near the top (the 40 px right under the sticky lines) or the bottom (72 px) of the scrolling body, one animation loop
     scrolls it by ceil((zone − d) / 4) px a frame (18 at most), the place found again each frame; never the window (the
     page is locked). Over the sticky lines themselves (the chips, the status line) it never scrolls: a chip held must
     show its truck, not be beaten by the loop (review F1); the top zone is small so the first row under the band can be
     aimed at (review F5).
   - Let go on a place → `drop`; on a refused place → `refused` (the row goes back). pointercancel, lostpointercapture,
     Escape → the row goes back, nothing changed.
   - A rebase that arrives during a drag waits for its end (`afterDrag`): re-keying the dragged row would fire
     lostpointercapture in the middle of the gesture (code F27).
   The DOM it reads: rows `[data-dayord-row][data-id][data-truck][data-block][data-index]`, the rows under way
   `[data-dayord-live][data-truck][data-block]`, ends `[data-dayord-end][data-truck]` (+ `data-block`), chips
   `[data-dayord-chip][data-truck]`, the sticky lines `.dayord-sticky` inside the body. Tested in listDrag.test.ts. */
import { signal, type Signal } from '@preact/signals';

/** where the dragged stop would land: before position `index` of that list as drawn (END: its end); `refused`: the
    reason it may not go there (then no line is drawn) */
export interface DropAt { truck: string; block: string; index: number; refused: string | null }
export interface ListDragOptions {
  /** the scrolling box (the sheet's body) */
  body: () => HTMLElement | null;
  /** the block of a stop: a drag stays in it */
  blockOf: (id: string) => string | null;
  /** may this stop go on that truck (that block)? null = yes, else the reason */
  check: (id: string, truck: string, block: string) => string | null;
  /** let go on a place */
  drop: (id: string, at: DropAt) => void;
  /** let go on a place it may not go (the row goes back; the reason is said) */
  refused: (id: string, why: string, at: DropAt) => void;
  /** a chip held: show that truck */
  toTruck: (truck: string) => void;
}
export const FINGER_PX = 4;
export const MOUSE_PX = 6;
export const EDGE_PX = 72;
/** the zone right under the sticky lines that scrolls the list up (smaller: the band already takes the top; review F5) */
export const EDGE_TOP_PX = 40;
export const EDGE_STEP_MAX = 18;
export const CHIP_HOLD_MS = 400;
/** « its end » (the sheet clamps it to the list's length) */
export const AT_END = Number.MAX_SAFE_INTEGER;

export interface ListDrag {
  /** the stop being dragged (its row is the placeholder) */
  dragging: Signal<string | null>;
  /** where it would land now */
  target: Signal<DropAt | null>;
  /** what the grip ≡ spreads (any pointer) */
  grip(id: string): { onPointerDown: (e: PointerEvent) => void };
  /** what the row's main button spreads (a mouse only; a click stays a click) */
  main(id: string): { onPointerDown: (e: PointerEvent) => void };
  /** the click that follows a drag is not a tap (the row's menu does not open) */
  justDragged(): boolean;
  /** a pointer is down on a row (dragging, or maybe about to) */
  active(): boolean;
  /** runs now, or once the gesture under way has ended */
  afterDrag(fn: () => void): void;
  /** ends the gesture under way, nothing changed */
  cancel(): void;
}

interface Track {
  id: string; pointerId: number; el: HTMLElement; row: HTMLElement;
  mouse: boolean; finger: boolean; x0: number; y0: number; x: number; y: number;
  /** where the pointer holds the row, and its width (the ghost) */
  dx: number; dy: number; w: number;
  started: boolean; ghost: HTMLElement | null;
}

const data = (el: Element | null | undefined, sel: string): HTMLElement | null => (el && typeof (el as HTMLElement).closest === 'function' ? (el as HTMLElement).closest(sel) as HTMLElement | null : null);
const same = (a: DropAt | null, b: DropAt | null) =>
  a === b || (!!a && !!b && a.truck === b.truck && a.block === b.block && a.index === b.index && a.refused === b.refused);

export function createListDrag(o: ListDragOptions): ListDrag {
  const dragging = signal<string | null>(null);
  const target = signal<DropAt | null>(null);
  let t: Track | null = null;
  let raf = 0;
  let speed = 0;
  let chip: { truck: string; timer: ReturnType<typeof setTimeout> | null; shown: boolean } | null = null;
  let after: (() => void)[] = [];
  let dragged = false;

  const raf$ = (fn: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16) as unknown as number);
  const unraf = (id: number) => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); else clearTimeout(id as unknown as ReturnType<typeof setTimeout>); };

  function begin(e: PointerEvent, id: string, grip: boolean) {
    if (t) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button !== 0) return;
    if (!grip && !mouse) return;                                    // a finger on the row scrolls the list
    const el = e.currentTarget as HTMLElement | null;
    const row = data(el, '[data-dayord-row]');
    if (!el || !row) return;
    if (grip) {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone: the drag works without the capture */ }
    }
    const r = row.getBoundingClientRect();
    t = { id, pointerId: e.pointerId, el, row, mouse, finger: e.pointerType === 'touch', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, started: false, ghost: null };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('lostpointercapture', onCancel);
  }
  function stopListening(el: HTMLElement) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    el.removeEventListener('lostpointercapture', onCancel);
  }

  function start(g: Track) {
    g.started = true;
    if (g.finger) { try { navigator.vibrate?.(12); } catch { /* no vibration on this phone */ } }
    const ghost = g.row.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-dayord-row');
    ghost.querySelectorAll('[data-testid],[id]').forEach((x) => { x.removeAttribute('data-testid'); x.removeAttribute('id'); });
    ghost.classList.remove('is-dragging');
    ghost.classList.add('dayord-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.dataset.testid = 'dayorder-ghost';
    ghost.style.width = `${g.w}px`;
    document.body.appendChild(ghost);
    g.ghost = ghost;
    dragging.value = g.id;
    paint(g);
  }
  function paint(g: Track) {
    if (g.ghost) g.ghost.style.transform = `translate3d(${Math.round(g.x - g.dx)}px, ${Math.round(g.y - g.dy)}px, 0)`;
  }

  /** the place under the pointer now */
  function find(g: Track) {
    const el = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(g.x, g.y) : null;
    const block = o.blockOf(g.id);
    let at: DropAt | null = null;
    const c = data(el, '[data-dayord-chip]');
    if (c?.dataset.truck) { holdChip(c.dataset.truck); if (block) at = { truck: c.dataset.truck, block, index: AT_END, refused: null }; } else dropChip();
    const row = at ? null : data(el, '[data-dayord-row]');
    if (row?.dataset.truck && row.dataset.block) {
      const r = row.getBoundingClientRect();
      const i = Number(row.dataset.index ?? 0);
      at = { truck: row.dataset.truck, block: row.dataset.block, index: g.y < r.top + r.height / 2 ? i : i + 1, refused: null };
    }
    const live = at ? null : data(el, '[data-dayord-live]');
    if (live?.dataset.truck) at = { truck: live.dataset.truck, block: live.dataset.block || block || 'day', index: 0, refused: null };
    const end = at ? null : data(el, '[data-dayord-end]');
    if (end?.dataset.truck && (end.dataset.block || block)) at = { truck: end.dataset.truck, block: end.dataset.block || block!, index: AT_END, refused: null };
    if (at) { const why = o.check(g.id, at.truck, at.block); if (why) at = { ...at, refused: why }; }
    if (!same(at, target.value)) target.value = at;
  }
  function holdChip(truck: string) {
    if (chip?.truck === truck) return;
    dropChip();
    chip = { truck, shown: false, timer: setTimeout(() => { if (chip?.truck === truck) { chip.shown = true; chip.timer = null; o.toTruck(truck); } }, CHIP_HOLD_MS) };
  }
  function dropChip() {
    if (chip?.timer) clearTimeout(chip.timer);
    chip = null;
  }

  /** near the top (under the sticky lines) or the bottom of the body: the speed of the scroll, 0 elsewhere */
  function edge(g: Track) {
    const b = o.body();
    if (!b) { speed = 0; return; }
    const r = b.getBoundingClientRect();
    const sticky = b.querySelector('.dayord-sticky')?.getBoundingClientRect();
    const top = sticky && sticky.bottom > r.top ? Math.min(sticky.bottom, r.bottom) : r.top;
    const dTop = g.y - top, dBottom = r.bottom - g.y;
    const step = (zone: number, d: number) => Math.min(EDGE_STEP_MAX, Math.ceil((zone - Math.max(0, d)) / 4));
    // on the band (a chip, the status line): never (its chip shows its truck)
    speed = dTop < 0 ? 0 : dTop < EDGE_TOP_PX ? -step(EDGE_TOP_PX, dTop) : dBottom < EDGE_PX ? step(EDGE_PX, dBottom) : 0;
    if (speed && !raf) raf = raf$(tick);
  }
  function tick() {
    raf = 0;
    const g = t;
    const b = o.body();
    if (!g?.started || !speed || !b) return;
    b.scrollTop += speed;
    find(g);
    edge(g);
  }

  function onMove(e: PointerEvent) {
    const g = t;
    if (!g || e.pointerId !== g.pointerId) return;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.started) {
      if (Math.hypot(g.x - g.x0, g.y - g.y0) < (g.mouse ? MOUSE_PX : FINGER_PX)) return;
      start(g);
    }
    if (e.cancelable) e.preventDefault();
    paint(g);
    find(g);
    edge(g);
  }
  function finish(commit: boolean) {
    const g = t;
    if (!g) return;
    t = null;
    stopListening(g.el);
    if (raf) { unraf(raf); raf = 0; }
    speed = 0;
    dropChip();
    g.ghost?.remove();
    const at = target.value;
    dragging.value = null;
    target.value = null;
    if (g.started) {
      dragged = true;
      setTimeout(() => { dragged = false; }, 0);
      if (commit && at) { if (at.refused) o.refused(g.id, at.refused, at); else o.drop(g.id, at); }
    }
    const later = after;
    after = [];
    for (const fn of later) fn();
  }
  function onUp(e: PointerEvent) { if (t && e.pointerId === t.pointerId) finish(true); }
  function onCancel(e: Event) { const id = (e as PointerEvent).pointerId; if (t && (id == null || id === t.pointerId)) finish(false); }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !t) return;
    // the sheet would close on this Escape: it only ends the drag
    e.stopPropagation();
    e.preventDefault();
    finish(false);
  }

  return {
    dragging, target,
    grip: (id) => ({ onPointerDown: (e) => begin(e, id, true) }),
    main: (id) => ({ onPointerDown: (e) => begin(e, id, false) }),
    justDragged: () => dragged,
    active: () => !!t,
    afterDrag: (fn) => { if (t) after.push(fn); else fn(); },
    cancel: () => finish(false)
  };
}
