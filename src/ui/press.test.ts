import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pressProps, PRESS_MS } from './ContextMenu';

const touch = (x: number, y: number, n = 1) => ({ touches: Array.from({ length: n }, () => ({ clientX: x, clientY: y })) }) as unknown as TouchEvent;
const click = () => { const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() }; return e as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> }; };

describe('the long press (iPhone and every touch screen)', () => {
  // each test a minute later (a press of the test before never counts)
  let n = 0;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2026, 10, 9, 12, n++, 0))); });
  afterEach(() => { vi.useRealTimers(); });

  it('held still half a second: the menu opens at the finger, and the tap that follows opens nothing', () => {
    const got: number[][] = [];
    const p = pressProps((x, y) => { got.push([x, y]); });
    p.onTouchStart(touch(40, 80));
    vi.advanceTimersByTime(PRESS_MS - 1);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(got).toEqual([[40, 80]]);
    p.onTouchEnd();
    const c = click();
    p.onClickCapture(c);
    expect(c.preventDefault).toHaveBeenCalled();
  });
  it('a quick tap opens the appointment as before; a scroll (the finger moves) opens nothing', () => {
    vi.advanceTimersByTime(5000);
    const got: number[][] = [];
    const p = pressProps((x, y) => { got.push([x, y]); });
    p.onTouchStart(touch(10, 10));
    vi.advanceTimersByTime(150);
    p.onTouchEnd();
    vi.advanceTimersByTime(PRESS_MS);
    const c = click();
    p.onClickCapture(c);
    expect(c.preventDefault).not.toHaveBeenCalled();
    p.onTouchStart(touch(10, 10));
    p.onTouchMove(touch(10, 40));
    vi.advanceTimersByTime(PRESS_MS * 2);
    expect(got).toEqual([]);
  });
  it('the innermost element wins: a ticket held inside a block opens the ticket’s menu, not the block’s', () => {
    vi.advanceTimersByTime(5000);
    const who: string[] = [];
    const ticket = pressProps(() => { who.push('ticket'); });
    const block = pressProps(() => { who.push('block'); });
    const e = touch(5, 5);
    ticket.onTouchStart(e);
    block.onTouchStart(e);   // the same event, bubbling up
    vi.advanceTimersByTime(PRESS_MS);
    expect(who).toEqual(['ticket']);
  });
  it('nothing to offer (the block refuses): the next tap still works', () => {
    vi.advanceTimersByTime(5000);
    const p = pressProps(() => false);
    p.onTouchStart(touch(5, 5));
    vi.advanceTimersByTime(PRESS_MS);
    const c = click();
    p.onClickCapture(c);
    expect(c.preventDefault).not.toHaveBeenCalled();
  });
});
