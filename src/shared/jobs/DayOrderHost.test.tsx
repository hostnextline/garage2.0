/* « Réorganiser la journée » opened in place (Part 28, REARRANGE.md §2.1): openDayOrder only for a day the person may
   rearrange; one sheet even when two screens' hosts are mounted; the request dropped when the last host goes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('./DayOrderSheet', () => ({ DayOrderSheet: (p: { at: { day: string; job?: string; first?: boolean } }) => <div data-testid="dayorder-sheet" data-day={p.at.day} data-first={String(!!p.at.first)} /> }));

import { DayOrderHost, openDayOrder, dayOrderOpenFor, closeDayOrder } from './DayOrderHost';
import { GRACE_MS } from './hosts';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { addDays, today } from '../../lib/dates';
import type { Access } from '../../data/types';

const DAY = addDays(today(), 2);
const box = document.createElement('div');
document.body.appendChild(box);
const sheets = () => document.querySelectorAll('[data-testid="dayorder-sheet"]');

beforeEach(() => {
  access.value = { id: 'u1', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
  replaceLocal('jobs', [{ id: 'j1', number: 1, day: DAY, block: 'day', status: 'booked', truck_id: 't1', deleted_at: null }] as never);
});
afterEach(async () => { await act(async () => { render(null, box); }); closeDayOrder(); clearAll(); access.value = null; vi.useRealTimers(); });

describe('openDayOrder / DayOrderHost', () => {
  it('opens that day on the screen; one sheet with two hosts mounted; « Mettre en premier » passes `first`', async () => {
    await act(async () => { render(<><DayOrderHost /><DayOrderHost /></>, box); });
    await act(async () => { openDayOrder(DAY, { truck: 't1', job: 'j1', first: true }); });
    expect(sheets().length).toBe(1);
    expect((sheets()[0] as HTMLElement).dataset.day).toBe(DAY);
    expect((sheets()[0] as HTMLElement).dataset.first).toBe('true');
    expect(dayOrderOpenFor()).toBe(DAY);
  });
  it('nothing for a past day, or a day with no stop the person may order', async () => {
    await act(async () => { render(<DayOrderHost />, box); });
    await act(async () => { openDayOrder(addDays(today(), -1)); });
    await act(async () => { openDayOrder(addDays(DAY, 5)); });
    expect(sheets().length).toBe(0);
    access.value = { id: 'u2', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t9'] } as unknown as Access;
    await act(async () => { openDayOrder(DAY); });
    expect(sheets().length).toBe(0);
  });
  it('the last host gone: the request is dropped (it never rises later on another screen)', async () => {
    vi.useFakeTimers();
    await act(async () => { render(<DayOrderHost />, box); });
    await act(async () => { openDayOrder(DAY); });
    await act(async () => { render(null, box); });
    await act(async () => { vi.advanceTimersByTime(GRACE_MS + 10); });
    expect(dayOrderOpenFor()).toBeNull();
  });
});
