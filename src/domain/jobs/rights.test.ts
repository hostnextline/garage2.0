import { describe, it, expect, afterEach } from 'vitest';
import { access } from '../../data/auth';
import type { Access, Job, Role, Right } from '../../data/types';
import { jobRights } from './rights';

const person = (o: { roles: Role[]; owner?: boolean; rights?: Partial<Record<Right, boolean>>; trucks?: string[] }): Access =>
  ({ id: 'me', full_name: 'Moi', short_name: null, email: null, phone: null, roles: o.roles, owner: !!o.owner, lang: 'fr', prefs: {}, color: null,
    rights: (o.rights || {}) as Record<Right, boolean>, trucks: o.trucks || [] });
const job = (o: Partial<Job> = {}) => ({ id: 'j1', truck_id: 't1', created_by: 'someone', status: 'booked', ...o } as Job);
afterEach(() => { access.value = null; });

describe('who may do what on a job: the server’s rule, never the office role alone (x-rights-17)', () => {
  it('the office with « Réserver »: everything of the office', () => {
    access.value = person({ roles: ['office'], rights: { book: true } });
    const r = jobRights(job());
    expect([r.move, r.reopen, r.verbal, r.editNotes, r.act]).toEqual([true, true, true, true, true]);
  });
  it('the office whose « Réserver » was taken off: no « Déplacer », « Rouvrir », « Il a dit oui », notes (the server refuses them)', () => {
    access.value = person({ roles: ['office'] });
    const r = jobRights(job());
    expect([r.move, r.reopen, r.verbal, r.editNotes, r.act]).toEqual([false, false, false, false, false]);
  });
  it('… except on a job she opened herself (the server lets its author work it and change its notes)', () => {
    access.value = person({ roles: ['office'] });
    const r = jobRights(job({ created_by: 'me' }));
    expect([r.act, r.reopen, r.verbal, r.editNotes, r.move]).toEqual([true, true, true, true, false]);
  });
  it('the owner: everything', () => {
    access.value = person({ roles: [], owner: true });
    const r = jobRights(job());
    expect([r.move, r.reopen, r.verbal, r.editNotes, r.act, r.payLater, r.backFromDone]).toEqual([true, true, true, true, true, true, true]);
  });
  it('the mechanic of the truck: moves it forward, no office buttons', () => {
    access.value = person({ roles: ['mechanic'], trucks: ['t1'] });
    const r = jobRights(job());
    expect([r.act, r.mine, r.invoice, r.order]).toEqual([true, true, true, true]);
    expect([r.move, r.reopen, r.verbal, r.editNotes, r.payLater]).toEqual([false, false, false, false, false]);
    expect(jobRights(job({ truck_id: 't2' })).act).toBe(false);
  });
});
