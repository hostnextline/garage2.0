import { describe, it, expect } from 'vitest';
import { jobMenu, mayBack } from './menu';
import type { JobStatus } from '../../data/types';

const all = { text: true, act: true, order: true, move: true, backFromDone: true, reopen: true };
const mech = { text: true, act: true, order: true, move: false, backFromDone: false, reopen: false };
const ctx = { edit: true, link: true, truck: true, coffre: true, invoiceDone: false, invoicePaid: false, arrivalText: true };
const J = (status: JobStatus, o: { truck_id?: string | null; coffre_id?: string | null } = {}) => ({ status, truck_id: 't1', coffre_id: null, ...o });

describe('the « … » menu of a job', () => {
  it('booked, for the office: everything that changes the appointment, in this order', () => {
    expect(jobMenu(J('booked'), all, ctx)).toEqual(['edit', 'resend', 'link', 'first', 'order', 'move', 'truck', 'noshow', 'cancel', 'coffre']);
  });
  it('on the way and on site', () => {
    expect(jobMenu(J('en_route'), mech, { ...ctx, edit: false, truck: false })).toEqual(['tracking', 'link', 'back', 'noshow', 'cancel', 'coffre']);
    expect(jobMenu(J('on_site'), mech, { ...ctx, edit: false, truck: false })).toEqual(['arrived', 'link', 'back', 'noshow', 'coffre']);
  });
  it('the arrival text only before the invoice is finished, and only when there is something to bill (jobs-a-10)', () => {
    expect(jobMenu(J('on_site'), mech, { ...ctx, invoiceDone: true })).not.toContain('arrived');
    expect(jobMenu(J('on_site'), mech, { ...ctx, arrivalText: false })).not.toContain('arrived');
  });
  it('done: back only for the owner and the office; the Coffre not once paid', () => {
    expect(jobMenu(J('done'), mech, { ...ctx, truck: false })).toEqual(['edit', 'link', 'coffre']);
    expect(jobMenu(J('done'), all, { ...ctx, truck: false, invoicePaid: true })).toEqual(['edit', 'link', 'back']);
  });
  it('closed: reopen for those who may', () => {
    expect(jobMenu(J('cancelled'), all, { ...ctx, edit: false, truck: false })).toEqual(['link', 'reopen']);
    expect(jobMenu(J('no_show'), mech, { ...ctx, edit: false, link: false, truck: false })).toEqual([]);
  });
  it('no truck: no order of the stops; already in the Coffre: not again', () => {
    expect(jobMenu(J('booked', { truck_id: null }), all, ctx)).not.toContain('order');
    expect(jobMenu(J('booked', { coffre_id: 'c' }), all, ctx)).not.toContain('coffre');
  });
  it('back', () => {
    expect(mayBack('booked', all)).toBe(false);
    expect(mayBack('en_route', mech)).toBe(true);
    expect(mayBack('done', mech)).toBe(false);
    expect(mayBack('done', all)).toBe(true);
    expect(mayBack('cancelled', all)).toBe(false);
  });
});
