/* The week's day head (Part 28, REARRANGE.md §3.2): a small warn count of that day's customers without their new hours,
   for the owner and « Réserver » only (the button lives on the day). Real store rows; Montréal's clock fixed. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { DayHdButton } from './WeekParts';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const owner = { id: 'u1', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'u3', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1'] } as unknown as Access;
const job = (id: string, o: Record<string, unknown>) => ({ id, number: 1, truck_id: 't1', block: 'am', status: 'booked', stop_order: 1, duration_min: 60, deleted_at: null, ...o });
const box = document.createElement('div');
document.body.appendChild(box);
const draw = async (day: string) => { await act(async () => { render(<DayHdButton day={day} onOpenDay={() => undefined} />, box); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T09:00:00-05:00'));
  lang.value = 'fr'; clearAll(); access.value = owner;
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1 }] as never);
  replaceLocal('jobs', [
    job('j1', { customer_id: 'c1', day: '2026-11-25' }),
    job('j2', { customer_id: 'c2', day: '2026-11-25', told_day: '2026-11-25', told_start: 480, told_end: 720, told_at: '2026-11-20T10:00:00-05:00' }),
    job('j3', { customer_id: 'c3', day: '2026-11-25', block: 'pm', told_day: '2026-11-25', told_start: 480, told_end: 720, told_at: '2026-11-20T10:00:00-05:00' })
  ] as never);
});
afterEach(() => { render(null, box); vi.useRealTimers(); access.value = null; });

describe('DayHdButton: the count of customers to tell', () => {
  it('2 on mercredi 25 (one never told, one moved to the afternoon); said to a screen reader too', async () => {
    await draw('2026-11-25');
    const mark = box.querySelector('[data-testid="dayhd-told-2026-11-25"]')!;
    expect(mark.textContent).toBe('2');
    expect(box.querySelector('button')!.getAttribute('aria-label')).toContain('2 clients n’ont pas leur nouvelle heure');
  });
  it('nothing on a day with nobody due, and nothing for a mechanic', async () => {
    await draw('2026-11-26');
    expect(box.querySelector('[data-testid^="dayhd-told"]')).toBeNull();
    access.value = mechanic;
    await draw('2026-11-25');
    expect(box.querySelector('[data-testid^="dayhd-told"]')).toBeNull();
  });
});
