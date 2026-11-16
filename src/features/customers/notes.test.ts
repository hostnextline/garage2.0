import { describe, it, expect } from 'vitest';
import { nextOn, quickDays, orderNotes, dueCount, noteState } from './notes';
import type { CustomerNote } from '../../data/types';

const note = (id: string, remind_on: string | null, done_at: string | null = null) => ({ id, remind_on, done_at }) as CustomerNote;

describe('notes of a customer', () => {
  it('spring and fall: this year when still to come, else next year', () => {
    expect(nextOn('2026-03-31', 4, 1)).toBe('2026-04-01');
    expect(nextOn('2026-04-01', 4, 1)).toBe('2027-04-01');
    expect(quickDays('2026-11-15').map((x) => x.day)).toEqual(['2026-12-15', '2027-02-15', '2027-04-01', '2027-10-15']);
  });
  it('reminders to do first (oldest due first), then the rest in their order', () => {
    const all = [note('a', null), note('b', '2026-12-01'), note('c', '2026-11-01'), note('d', '2026-10-01', '2026-10-02')];
    expect(orderNotes(all).map((n) => n.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(dueCount(all, '2026-11-15')).toBe(1);
  });
  it('the pill', () => {
    expect([note('a', null), note('b', '2026-11-01'), note('c', '2026-11-15'), note('d', '2026-12-01'), note('e', '2026-11-01', 'x')].map((n) => noteState(n, '2026-11-15')))
      .toEqual([null, 'late', 'today', 'later', 'done']);
  });
});
