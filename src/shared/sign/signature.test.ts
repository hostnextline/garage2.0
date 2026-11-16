import { describe, it, expect } from 'vitest';
import { strokeLength, inkBox, hasEnoughInk, trimPlan, INK, SAVE, type Stroke } from './signature';

const line = (x0: number, y0: number, x1: number, y1: number, n = 10): Stroke =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
/** a believable signature: a few loops across 220 × 50 px */
const signature: Stroke[] = [
  Array.from({ length: 60 }, (_, i) => ({ x: 40 + i * 3.5, y: 120 + Math.sin(i / 3) * 22 })),
  line(70, 150, 230, 140)
];

describe('ink', () => {
  it('measures the strokes', () => {
    expect(strokeLength([])).toBe(0);
    expect(strokeLength([line(0, 0, 30, 40)])).toBeCloseTo(50);
    expect(strokeLength([[{ x: 5, y: 5 }]])).toBe(0);
  });
  it('boxes the ink, line width included', () => {
    expect(inkBox([])).toBeNull();
    expect(inkBox([[]])).toBeNull();
    const b = inkBox([line(10, 20, 110, 70)], 2)!;
    expect(b).toEqual({ x: 9, y: 19, w: 102, h: 52 });
    // points that are not numbers are ignored
    expect(inkBox([[{ x: NaN, y: 3 }, { x: 4, y: 4 }]], 0)).toEqual({ x: 4, y: 4, w: 0, h: 0 });
  });
  it('a tap, a dot or a short tick is not a signature', () => {
    expect(hasEnoughInk([])).toBe(false);
    expect(hasEnoughInk([[{ x: 50, y: 50 }]])).toBe(false);
    expect(hasEnoughInk([line(50, 50, 70, 52)])).toBe(false);
    // long enough but scribbled on the spot: under the minimum size
    expect(hasEnoughInk([[...line(50, 50, 60, 60), ...line(60, 60, 50, 50), ...line(50, 50, 60, 60), ...line(60, 60, 50, 50), ...line(50, 50, 60, 60)]])).toBe(false);
    expect(hasEnoughInk(signature)).toBe(true);
    expect(hasEnoughInk([line(10, 10, 10 + INK.minLength, 10)])).toBe(true);
  });
});

describe('the saved picture', () => {
  it('is cut to the ink with a margin, at twice the size when it fits', () => {
    const box = inkBox(signature)!;
    const p = trimPlan(box);
    expect(p.scale).toBe(SAVE.scale);
    expect(p.width).toBe(Math.round((box.w + 2 * SAVE.pad) * 2));
    expect(p.height).toBe(Math.round((box.h + 2 * SAVE.pad) * 2));
    // the top-left of the ink lands on the margin
    expect((box.x + p.dx) * p.scale).toBeCloseTo(SAVE.pad * p.scale);
    expect((box.y + p.dy) * p.scale).toBeCloseTo(SAVE.pad * p.scale);
    // the bottom-right of the ink stays inside the picture, one margin from the edge
    expect((box.x + box.w + p.dx) * p.scale).toBeCloseTo(p.width - SAVE.pad * p.scale, 0);
  });
  it('is never wider than 600 px, and keeps its shape', () => {
    const wide = { x: 0, y: 0, w: 1200, h: 200 };
    const p = trimPlan(wide);
    expect(p.width).toBeLessThanOrEqual(600);
    expect(p.width).toBe(600);
    expect(p.height / p.width).toBeCloseTo((200 + 16) / (1200 + 16), 2);
    const mid = trimPlan({ x: 0, y: 0, w: 400, h: 100 });
    expect(mid.width).toBeLessThanOrEqual(600);
    expect(trimPlan({ x: 0, y: 0, w: 280, h: 60 }, { maxWidth: 300 }).width).toBe(300);
  });
  it('never makes an empty picture', () => {
    const p = trimPlan({ x: 5, y: 5, w: 0, h: 0 }, { pad: 0 });
    expect(p.width).toBeGreaterThanOrEqual(1);
    expect(p.height).toBeGreaterThanOrEqual(1);
  });
});
