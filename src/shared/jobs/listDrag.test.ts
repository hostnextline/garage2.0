/* The drag of « Réorganiser la journée » (Part 28, REARRANGE.md §2.3, U3), on a small DOM of rows (jsdom: the positions
   are pretended with getBoundingClientRect and elementFromPoint). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createListDrag, AT_END, CHIP_HOLD_MS, type DropAt, type ListDragOptions } from './listDrag';

/** a pointer event as the browser sends it (jsdom has no PointerEvent) */
function pe(type: string, o: { x?: number; y?: number; id?: number; kind?: string; button?: number } = {}): PointerEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.assign(e, { clientX: o.x ?? 0, clientY: o.y ?? 0, pointerId: o.id ?? 1, pointerType: o.kind ?? 'touch', button: o.button ?? 0 });
  return e;
}
const rect = (top: number, height: number, left = 0, width = 300) =>
  ({ top, bottom: top + height, left, right: left + width, height, width, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

let sheet: HTMLElement, body: HTMLElement, sticky: HTMLElement;
const rows: Record<string, HTMLElement> = {};
let under: Element | null = null;
const calls: { drop: [string, DropAt][]; refused: [string, string][]; toTruck: string[] } = { drop: [], refused: [], toTruck: [] };
let check: ListDragOptions['check'] = () => null;

function row(id: string, truck: string, index: number, top: number) {
  const r = document.createElement('div');
  Object.assign(r.dataset, { dayordRow: '', id, truck, block: 'day', index: String(index) });
  r.innerHTML = `<button class="dayord-grip" data-testid="grip-${id}">≡</button><button class="dayord-main" data-testid="main-${id}">${id}</button>`;
  r.getBoundingClientRect = () => rect(top, 64);
  body.appendChild(r);
  rows[id] = r;
  return r;
}
const grip = (id: string) => rows[id].querySelector('.dayord-grip') as HTMLElement;
const main = (id: string) => rows[id].querySelector('.dayord-main') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  calls.drop = []; calls.refused = []; calls.toTruck = [];
  check = () => null;
  sheet = document.createElement('div');
  sheet.className = 'sheet glass-strong';
  body = document.createElement('div');
  body.className = 'sheet-body';
  body.getBoundingClientRect = () => rect(100, 600);
  sticky = document.createElement('div');
  sticky.className = 'dayord-sticky';
  sticky.getBoundingClientRect = () => rect(100, 96);
  body.appendChild(sticky);
  sheet.appendChild(body);
  document.body.appendChild(sheet);
  row('a', 'A', 0, 300); row('b', 'A', 1, 364); row('c', 'A', 2, 428);
  const end = document.createElement('div');
  Object.assign(end.dataset, { dayordEnd: '', truck: 'B', block: 'day' });
  body.appendChild(end);
  const chip = document.createElement('button');
  Object.assign(chip.dataset, { dayordChip: '', truck: 'B' });
  sticky.appendChild(chip);
  rows.end = end; rows.chip = chip;
  (document as { elementFromPoint?: unknown }).elementFromPoint = () => under;
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; under = null; });

function make() {
  return createListDrag({
    body: () => body, blockOf: () => 'day', check: (...a) => check(...a),
    drop: (id, at) => calls.drop.push([id, at]), refused: (id, why) => calls.refused.push([id, why]), toTruck: (tr) => calls.toTruck.push(tr)
  });
}
function down(d: ReturnType<typeof make>, id: string, el: HTMLElement, o: Parameters<typeof pe>[1] = {}, onGrip = true) {
  const e = pe('pointerdown', o);
  Object.defineProperty(e, 'currentTarget', { value: el });
  el.setPointerCapture = () => undefined;
  (onGrip ? d.grip(id) : d.main(id)).onPointerDown(e);
  return e;
}
const move = (x: number, y: number, o: Parameters<typeof pe>[1] = {}) => window.dispatchEvent(pe('pointermove', { x, y, ...o }));
const up = (o: Parameters<typeof pe>[1] = {}) => window.dispatchEvent(pe('pointerup', o));

describe('a drag by the grip', () => {
  it('past 4 px it starts: the ghost on document.body (never inside the sheet), the place under the finger, let go → drop', () => {
    const d = make();
    const e = down(d, 'c', grip('c'), { x: 20, y: 440 });
    expect(e.defaultPrevented).toBe(true);
    move(20, 442);                                                                  // 2 px: not yet a drag
    expect(d.dragging.value).toBeNull();
    under = main('a');
    move(20, 310);                                                                  // over a's upper half
    expect(d.dragging.value).toBe('c');
    const ghost = document.querySelector('.dayord-ghost') as HTMLElement;
    expect(ghost.parentElement).toBe(document.body);
    expect(sheet.contains(ghost)).toBe(false);
    expect(ghost.getAttribute('data-dayord-row')).toBeNull();
    expect(ghost.querySelector('[data-testid]')).toBeNull();
    expect(ghost.style.transform).toContain('translate3d(');
    expect(d.target.value).toEqual({ truck: 'A', block: 'day', index: 0, refused: null });
    under = main('b');
    move(20, 400);                                                                  // b's lower half (364 + 32 = 396): after b
    expect(d.target.value?.index).toBe(2);
    up();
    expect(calls.drop).toEqual([['c', { truck: 'A', block: 'day', index: 2, refused: null }]]);
    expect(document.querySelector('.dayord-ghost')).toBeNull();
    expect(d.dragging.value).toBeNull();
    expect(d.justDragged()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(d.justDragged()).toBe(false);
  });
  it('under the threshold: nothing moves, nothing dropped (the grip\'s own click decides)', () => {
    const d = make();
    down(d, 'a', grip('a'), { x: 10, y: 310 });
    move(12, 312);
    up();
    expect(calls.drop).toEqual([]);
    expect(d.justDragged()).toBe(false);
  });
  it('an end slot or a truck head: the end of that truck; a refused place: no drop, the reason said', () => {
    const d = make();
    down(d, 'a', grip('a'), { x: 10, y: 310 });
    under = rows.end;
    move(10, 500);
    expect(d.target.value).toEqual({ truck: 'B', block: 'day', index: AT_END, refused: null });
    check = (_id, truck) => (truck === 'B' ? 'machine' : null);
    move(10, 501);
    expect(d.target.value?.refused).toBe('machine');
    up();
    expect(calls.drop).toEqual([]);
    expect(calls.refused).toEqual([['a', 'machine']]);
  });
  it('pointercancel, lostpointercapture, Escape: the row goes back, nothing changed, the scroll loop stopped', () => {
    const d = make();
    for (const end of ['pointercancel', 'lost', 'escape'] as const) {
      down(d, 'a', grip('a'), { x: 10, y: 310 });
      under = main('c');
      move(10, 650);                                                                // near the bottom: the loop runs
      expect(d.dragging.value).toBe('a');
      if (end === 'pointercancel') window.dispatchEvent(pe('pointercancel'));
      else if (end === 'lost') grip('a').dispatchEvent(pe('lostpointercapture'));
      else {
        const sheetEscape = vi.fn();
        document.addEventListener('keydown', sheetEscape);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(sheetEscape).not.toHaveBeenCalled();                                // the sheet does not close
        document.removeEventListener('keydown', sheetEscape);
      }
      expect(d.dragging.value).toBeNull();
      expect(document.querySelector('.dayord-ghost')).toBeNull();
      const top = body.scrollTop;
      vi.advanceTimersByTime(200);
      expect(body.scrollTop).toBe(top);
    }
    expect(calls.drop).toEqual([]);
  });
  it('near the bottom the body scrolls by itself (18 px a frame at most), near the top under the sticky lines it goes up', () => {
    const d = make();
    down(d, 'a', grip('a'), { x: 10, y: 310 });
    under = main('c');
    move(10, 695);                                                                  // 5 px from the bottom (700)
    vi.advanceTimersByTime(16);
    expect(body.scrollTop).toBe(17);                                               // ceil((72 − 5) / 4)
    move(10, 699);
    vi.advanceTimersByTime(16 * 3);
    expect(body.scrollTop).toBeGreaterThanOrEqual(17 + 18);
    body.scrollTop = 200;
    move(10, 200);                                                                  // 4 px under the sticky lines (196)
    vi.advanceTimersByTime(16);
    expect(body.scrollTop).toBeLessThan(200);
    move(10, 400);                                                                  // the middle: it stops
    const at = body.scrollTop;
    vi.advanceTimersByTime(100);
    expect(body.scrollTop).toBe(at);
    up();
  });
  it('a chip held 400 ms: that truck is shown and the drag goes on; let go on it: the end of that truck', () => {
    const d = make();
    down(d, 'b', grip('b'), { x: 10, y: 380 });
    under = rows.chip;
    move(10, 120);
    vi.advanceTimersByTime(CHIP_HOLD_MS - 50);
    expect(calls.toTruck).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(calls.toTruck).toEqual(['B']);
    expect(d.dragging.value).toBe('b');
    up();
    expect(calls.drop).toEqual([['b', { truck: 'B', block: 'day', index: AT_END, refused: null }]]);
  });
});

describe('the mouse, the finger on the row, and what waits for the end', () => {
  it('a mouse drags the whole row from its main button (6 px), without taking the click away before it moves', () => {
    const d = make();
    const e = down(d, 'a', main('a'), { x: 10, y: 310, kind: 'mouse' }, false);
    expect(e.defaultPrevented).toBe(false);
    move(10, 314, { kind: 'mouse' });                                              // 4 px: a mouse needs 6
    expect(d.dragging.value).toBeNull();
    under = main('c');
    move(10, 470, { kind: 'mouse' });                                              // c's lower half: after c
    expect(d.dragging.value).toBe('a');
    up({ kind: 'mouse' });
    expect(calls.drop.map(([id, at]) => [id, at.index])).toEqual([['a', 3]]);
  });
  it('a finger on the row\'s main button does nothing (the list scrolls); the right button of a mouse neither', () => {
    const d = make();
    down(d, 'a', main('a'), { x: 10, y: 310, kind: 'touch' }, false);
    move(10, 400);
    expect(d.active()).toBe(false);
    down(d, 'a', grip('a'), { x: 10, y: 310, kind: 'mouse', button: 2 });
    expect(d.active()).toBe(false);
  });
  it('a rebase during a drag waits for its pointerup (code F27); without a drag it runs at once', () => {
    const d = make();
    const ran: string[] = [];
    d.afterDrag(() => ran.push('now'));
    expect(ran).toEqual(['now']);
    down(d, 'a', grip('a'), { x: 10, y: 310 });
    under = main('c');
    move(10, 450);
    d.afterDrag(() => ran.push('later'));
    expect(ran).toEqual(['now']);
    up();
    expect(ran).toEqual(['now', 'later']);
  });
});
