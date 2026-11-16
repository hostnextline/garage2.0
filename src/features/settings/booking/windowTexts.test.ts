import { describe, it, expect } from 'vitest';
import { flexibleWithWindow, tellOutcome, windowOver } from './windowTexts';

describe('« Fixer les plages »: who is texted, who is not (settings-team-02, x-errors-17)', () => {
  it('the booked flexible appointments with a window are texted; the others are not', () => {
    const j = (id: string, x: Record<string, unknown>) => ({ id, block: 'day', status: 'booked', win_flex: true, win_start: 840, ...x }) as never;
    expect(flexibleWithWindow([j('a', {}), j('b', { win_start: null }), j('c', { win_flex: false }), j('d', { status: 'cancelled' }), j('e', { block: 'am' })])).toEqual(['a']);
  });
  it('sent and already told count; a failure, texts unplugged or no phone are listed to tell by hand', () => {
    const r = tellOutcome([
      { id: 'a', ok: true, status: 'sent' },
      { id: 'b', ok: true, status: 'already' },
      { id: 'c', ok: false, status: 'off', message: 'Bonjour…', phone: '5145551234' },
      { id: 'd', ok: false, status: 'no_phone', message: 'Bonjour…', phone: null },
      { id: 'e', ok: false, status: 'error', message: 'Bonjour…', phone: '5145550000' },
      { id: 'f', failed: true }
    ], false);
    expect(r.told).toBe(2);
    expect(r.untold.map((u) => u.id)).toEqual(['c', 'd', 'e', 'f']);
    expect(r.untold[0]).toEqual({ id: 'c', phone: '5145551234', message: 'Bonjour…' });
  });
  it('nothing to tell (cancelled, no window) is not listed; quiet is listed unless the owner switched the text off', () => {
    const answers = [{ id: 'a', ok: false, code: 'not_booked' }, { id: 'b', ok: false, code: 'no_window' }, { id: 'c', ok: false, status: 'quiet' }];
    expect(tellOutcome(answers, false).untold.map((u) => u.id)).toEqual(['c']);
    expect(tellOutcome(answers, true).untold).toEqual([]);
  });
  it('a window of today already over is not told any more; tomorrow, or a window still ahead, is (settings-team-st-2)', () => {
    const j = (day: string, win_end: number | null, win_start: number | null = 480) => ({ day, win_start, win_end });
    expect(windowOver(j('2026-11-16', 720), '2026-11-16', 1200)).toBe(true);
    expect(windowOver(j('2026-11-16', 720), '2026-11-16', 720)).toBe(true);
    expect(windowOver(j('2026-11-16', 1200), '2026-11-16', 1080)).toBe(false);
    expect(windowOver(j('2026-11-17', 720), '2026-11-16', 1200)).toBe(false);
    expect(windowOver(j('2026-11-16', null, 600), '2026-11-16', 1200)).toBe(true);
    expect(windowOver(j('2026-11-16', null, null), '2026-11-16', 1200)).toBe(false);
    expect(windowOver(undefined, '2026-11-16', 1200)).toBe(false);
  });
});
