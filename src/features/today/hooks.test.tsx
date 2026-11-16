/* The day of « Aujourd'hui » rolls over at midnight on a phone left open with nothing else changing (x-reactivity-33). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useToday } from './hooks';

const box = document.createElement('div');
document.body.appendChild(box);
function Day() { return <span>{useToday()}</span>; }
afterEach(() => { act(() => render(null, box)); vi.useRealTimers(); });

describe('useToday', () => {
  it('gives the new day a minute after midnight, without any other redraw', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T23:59:30'));
    act(() => render(<Day />, box));
    expect(box.textContent).toBe('2026-11-17');
    act(() => { vi.setSystemTime(new Date('2026-11-18T00:00:30')); vi.advanceTimersByTime(60_000); });
    expect(box.textContent).toBe('2026-11-18');
  });
  it('checks again when the app comes back to the front', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T22:00:00'));
    act(() => render(<Day />, box));
    act(() => { vi.setSystemTime(new Date('2026-11-18T07:00:00')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(box.textContent).toBe('2026-11-18');
  });
});
