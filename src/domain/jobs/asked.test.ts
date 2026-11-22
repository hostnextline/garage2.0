/* The answers a sheet keeps while it is open (« Vraies routes »: move_preview, stop_order_preview): one per key, asked
   once per measure of the roads (roadsTick), the answer on screen kept until a newer one of the SAME key replaces it,
   an older ask answering last dropped (review-sheets L2, K2). */
import { describe, it, expect } from 'vitest';
import { Answers, ASKING, NO_ANSWER } from './asked';

describe('Answers', () => {
  it('a key never asked shows « asking »; asked once per tick', () => {
    const a = new Answers<number>();
    expect(a.shown('k')).toEqual(ASKING);
    expect(a.asked('k', 0)).toBe(false);
    expect(a.start('k', 0)).toBe(true);
    expect(a.asked('k', 0)).toBe(true);
    expect(a.start('k', 0)).toBe(false);
    expect(a.take('k', 0, 7)).toBe(true);
    expect(a.shown('k')).toEqual({ kind: 'done', answer: 7 });
  });
  it('no preview (null) or an error (undefined): « none »', () => {
    const a = new Answers<number>();
    a.start('k', 0); a.take('k', 0, null);
    expect(a.shown('k')).toEqual(NO_ANSWER);
    a.start('j', 0); a.take('j', 0, undefined);
    expect(a.shown('j')).toEqual(NO_ANSWER);
  });
  it('a measure that ends: asked again, the answer shown kept until the new one; a failed new ask keeps it', () => {
    const a = new Answers<number>();
    a.start('k', 0); a.take('k', 0, 7);
    expect(a.start('k', 1)).toBe(true);
    expect(a.shown('k')).toEqual({ kind: 'done', answer: 7 });
    a.take('k', 1, 8);
    expect(a.shown('k')).toEqual({ kind: 'done', answer: 8 });
    a.start('k', 2); a.take('k', 2, undefined);
    expect(a.shown('k')).toEqual({ kind: 'done', answer: 8 });
  });
  it('the answer of an older ask arriving after a newer ask started is dropped', () => {
    const a = new Answers<number>();
    a.start('k', 0);
    a.start('k', 1);
    expect(a.take('k', 1, 9)).toBe(true);
    expect(a.take('k', 0, 5)).toBe(false);
    expect(a.shown('k')).toEqual({ kind: 'done', answer: 9 });
  });
  it('each key apart: an answer never shows under another key', () => {
    const a = new Answers<number>();
    a.start('k', 0); a.take('k', 0, 7);
    expect(a.shown('j')).toEqual(ASKING);
    expect(a.take('j', 0, 3)).toBe(false);
  });
});
