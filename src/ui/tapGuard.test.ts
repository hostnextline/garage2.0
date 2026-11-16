import { describe, it, expect } from 'vitest';
import { createTapGuard, tapPausesForTests, ARM_DEAD_MS, CONFIRM_MS, COOL_MS } from './tapGuard';

// the guard's own tests: the real pauses (src/test-setup.ts turns them off for the other tests)
tapPausesForTests(true);

const guard = (confirm = false, blocked = false) => createTapGuard({ confirm: () => confirm, blocked: () => blocked });

describe('a tap on a kit button', () => {
  it('a plain button acts on each tap', () => {
    const g = guard();
    expect(g.tap(0)).toBe('act');
    expect(g.tap(10)).toBe('act');
  });
  it('a disabled (or busy prop) button never acts', () => {
    expect(guard(false, true).tap(0)).toBe('ignore');
    expect(guard(true, true).tap(0)).toBe('ignore');
  });
  it('a pending action holds the button; a cool-down follows (the second tap of a double tap does nothing)', () => {
    const g = guard();
    expect(g.tap(0)).toBe('act');
    g.start();
    expect(g.tap(5)).toBe('ignore');          // two clicks in the same instant: one action
    g.settle(20);
    expect(g.tap(150)).toBe('ignore');        // the answer came back at once (« gardé sur le téléphone »)
    expect(g.tap(20 + COOL_MS)).toBe('act');
  });
  it('typing after the answer ends the cool-down (a correction after a refusal is not a double tap)', () => {
    let typed = 0;
    const g = createTapGuard({ confirm: () => false, blocked: () => false, lastInputAt: () => typed });
    g.tap(0); g.start(); g.settle(10);
    expect(g.tap(50)).toBe('ignore');
    typed = 60;
    expect(g.tap(70)).toBe('act');
  });
});

describe('« Toucher encore pour… » (confirm)', () => {
  it('a double tap (0 and 150 ms) arms and does nothing (old logic: acted on the second tap)', () => {
    const g = guard(true);
    expect(g.tap(0)).toBe('arm');
    expect(g.tap(150)).toBe('ignore');
  });
  it('taps at 0 and 800 ms act once', () => {
    const g = guard(true);
    expect(g.tap(0)).toBe('arm');
    expect(g.tap(800)).toBe('act');
    expect(g.tap(900)).toBe('arm');           // the next action asks again
  });
  it('the dead time ends after ARM_DEAD_MS; after CONFIRM_MS the button asks again', () => {
    const g = guard(true);
    g.tap(0);
    expect(g.tap(ARM_DEAD_MS - 1)).toBe('ignore');
    expect(g.tap(ARM_DEAD_MS)).toBe('act');
    const h = guard(true);
    h.tap(0);
    expect(h.tap(CONFIRM_MS)).toBe('arm');
  });
  it('disarmed by its timer: the next tap arms again', () => {
    const g = guard(true);
    g.tap(0);
    g.disarm();
    expect(g.tap(1000)).toBe('arm');
  });
});
