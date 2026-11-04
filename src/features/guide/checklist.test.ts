import { describe, it, expect } from 'vitest';
import { computeChecklist, nextStep, progress, rolesOf, mainRole, type GuideInput, type Role } from './checklist';

function input(o: Partial<GuideInput> & { roles?: Role[]; owner?: boolean } = {}): GuideInput {
  const { roles = ['owner'], owner = roles.includes('owner'), ...rest } = o;
  return {
    me: { id: 'me', roles, owner, trucks: [] },
    company: {}, taxesOn: true, services: [], trucks: [], trucksWithHours: [], staff: [{ id: 'me', active: true }],
    invitations: null, secrets: { ghl: null, stripe: null }, jobs: [], shifts: [], expenses: [], marks: {}, tours: {},
    ...rest
  };
}
const byId = (steps: ReturnType<typeof computeChecklist>) => Object.fromEntries(steps.map((s) => [s.id, s]));

describe('the owner’s first steps', () => {
  it('starts with nothing done, and the server checks unknown without signal', () => {
    const s = computeChecklist(input());
    expect(s.map((x) => x.id)).toEqual(['company', 'services', 'trucks', 'team', 'texts', 'cards', 'booking', 'tour']);
    const m = byId(s);
    expect(m.company.done).toBe(false);
    expect(m.company.detail).toEqual({ key: 'missing', list: ['name', 'phone', 'address', 'tps', 'tvq'] });
    expect(m.services.detail).toEqual({ key: 'noServices' });
    expect(m.trucks.detail).toEqual({ key: 'noTruck' });
    expect(m.team.detail).toEqual({ key: 'alone' });
    expect(m.texts.done).toBeNull();
    expect(m.cards.done).toBeNull();
    expect(nextStep(s)?.id).toBe('company');
    expect(progress(s)).toEqual({ done: 0, total: 8 });
  });
  it('asks for the tax numbers only when the garage charges taxes', () => {
    const c = { name: 'Mécanique Mobile H.I.S', phone: '438 901-6606', address: '8255 av. Mountain Sights' };
    expect(byId(computeChecklist(input({ company: c }))).company.detail).toEqual({ key: 'missing', list: ['tps', 'tvq'] });
    expect(byId(computeChecklist(input({ company: c, taxesOn: false }))).company.done).toBe(true);
    expect(byId(computeChecklist(input({ company: { ...c, tps_no: '775958648 RT0001', tvq_no: '1234321141 TQ0001' } }))).company.done).toBe(true);
    expect(byId(computeChecklist(input({ company: { ...c, phone: '   ', tps_no: 'x', tvq_no: 'y' } }))).company.detail?.list).toEqual(['phone']);
  });
  it('wants every active service priced, then the owner’s « C’est vérifié »', () => {
    const services = [{ active: true, price_cents: 8999 }, { active: true, price_cents: null }, { active: false, price_cents: null }];
    let m = byId(computeChecklist(input({ services })));
    expect(m.services.done).toBe(false);
    expect(m.services.detail).toEqual({ key: 'unpriced', vars: { n: 1 } });
    expect(m.services.canConfirm).toBe(false);
    const priced = [{ active: true, price_cents: 8999 }, { active: false, price_cents: null }];
    m = byId(computeChecklist(input({ services: priced })));
    expect(m.services.done).toBe(false);
    expect(m.services.detail).toEqual({ key: 'confirmPrices' });
    expect(m.services.canConfirm).toBe(true);
    m = byId(computeChecklist(input({ services: priced, marks: { services: '2026-11-04' } })));
    expect(m.services.done).toBe(true);
    expect(m.services.canConfirm).toBe(false);
  });
  it('checks each active truck for a mechanic and working hours', () => {
    const trucks = [{ id: 't1', name: 'Camion Complet', active: true, driver_id: 'saleh' }, { id: 't2', name: 'Voiture', active: true, driver_id: null }, { id: 't3', name: 'Camion 3', active: false, driver_id: null }];
    let m = byId(computeChecklist(input({ trucks, trucksWithHours: ['t1'] })));
    expect(m.trucks.detail).toEqual({ key: 'noDriver', vars: { name: 'Voiture' } });
    m = byId(computeChecklist(input({ trucks: [trucks[0], { ...trucks[1], driver_id: 'adam' }, trucks[2]], trucksWithHours: ['t1'] })));
    expect(m.trucks.detail).toEqual({ key: 'noHours', vars: { name: 'Voiture' } });
    m = byId(computeChecklist(input({ trucks: [trucks[0], { ...trucks[1], driver_id: 'adam' }, trucks[2]], trucksWithHours: ['t1', 't2'] })));
    expect(m.trucks.done).toBe(true);
  });
  it('counts the team as invited with another person or an invitation waiting', () => {
    expect(byId(computeChecklist(input({ staff: [{ id: 'me', active: true }, { id: 'x', active: false }] }))).team.done).toBe(false);
    expect(byId(computeChecklist(input({ staff: [{ id: 'me', active: true }, { id: 'saleh', active: true }] }))).team.done).toBe(true);
    expect(byId(computeChecklist(input({ invitations: 2 }))).team.done).toBe(true);
  });
  it('reads texts and card payments from the server, and the first booking from the jobs', () => {
    const m = byId(computeChecklist(input({ secrets: { ghl: true, stripe: false }, jobs: [{ truck_id: null, status: 'booked', created_by: 'x' }] })));
    expect(m.texts.done).toBe(true);
    expect(m.cards.done).toBe(false);
    expect(m.cards.detail).toBeNull();
    expect(m.booking.done).toBe(true);
  });
  it('skips the steps it can’t check and suggests the next real one', () => {
    const s = computeChecklist(input({
      company: { name: 'G', phone: '1', address: 'a', tps_no: 't', tvq_no: 'q' }, services: [{ active: true, price_cents: 1 }], marks: { services: 'x' },
      trucks: [{ id: 't1', name: 'C', active: true, driver_id: 'd' }], trucksWithHours: ['t1'], invitations: 1
    }));
    expect(nextStep(s)?.id).toBe('booking');
    expect(progress(s)).toEqual({ done: 4, total: 8 });
  });
  it('ends with the guided tour of the main role', () => {
    expect(byId(computeChecklist(input({ tours: { owner: '2026-11-04' } }))).tour.done).toBe(true);
    expect(byId(computeChecklist(input({ tours: { office: '2026-11-04' } }))).tour.done).toBe(false);
  });
});

describe('the other roles', () => {
  it('office: my own first booking, finding a customer, the agenda', () => {
    const base = input({ roles: ['office'] });
    let s = computeChecklist(base);
    expect(s.map((x) => x.id)).toEqual(['book', 'customers', 'agenda', 'tour']);
    expect(s.every((x) => x.done === false)).toBe(true);
    s = computeChecklist({ ...base, jobs: [{ truck_id: null, status: 'booked', created_by: 'someone' }] });
    expect(byId(s).book.done).toBe(false);
    s = computeChecklist({ ...base, jobs: [{ truck_id: null, status: 'booked', created_by: 'me' }], marks: { customers: 'x', agenda: 'x' } });
    expect(s.filter((x) => x.done).map((x) => x.id)).toEqual(['book', 'customers', 'agenda']);
    expect(nextStep(s)?.id).toBe('tour');
  });
  it('mechanic: my day started, a job finished on my truck, what happens without signal', () => {
    const base = input({ roles: ['mechanic'], me: { id: 'me', roles: ['mechanic'], owner: false, trucks: ['t1'] } });
    let s = computeChecklist(base, 'j-9');
    expect(s.map((x) => x.id)).toEqual(['day', 'job', 'offline', 'tour']);
    expect(byId(s).job.href).toBe('/job/j-9');
    expect(byId(s).job.anchor).toBe('job-bigstep');
    expect(byId(computeChecklist(base)).job).toMatchObject({ href: '/', anchor: 'today-next' });
    s = computeChecklist({ ...base, shifts: [{ staff_id: 'other' }], jobs: [{ truck_id: 't2', status: 'done' }] });
    expect(byId(s).day.done).toBe(false);
    expect(byId(s).job.done).toBe(false);
    s = computeChecklist({ ...base, shifts: [{ staff_id: 'me' }], jobs: [{ truck_id: 't1', status: 'done' }], marks: { offline: 'x' } });
    expect(s.filter((x) => x.done).map((x) => x.id)).toEqual(['day', 'job', 'offline']);
    expect(byId(computeChecklist(input({ roles: ['mechanic'] }))).job.detail).toEqual({ key: 'noTruckMine' });
  });
  it('treasurer: an expense with its receipt photo, the report', () => {
    const base = input({ roles: ['treasurer'] });
    expect(computeChecklist(base).map((x) => x.id)).toEqual(['expense', 'report', 'tour']);
    expect(byId(computeChecklist({ ...base, expenses: [{ receipt_id: null }] })).expense.done).toBe(false);
    expect(byId(computeChecklist({ ...base, expenses: [{ receipt_id: 'att-1' }] })).expense.done).toBe(true);
    expect(byId(computeChecklist({ ...base, marks: { report: 'x' } })).report.done).toBe(true);
  });
  it('several roles: each role’s steps once, the owner’s booking covering the office’s', () => {
    expect(rolesOf({ roles: ['mechanic', 'owner'], owner: true })).toEqual(['owner', 'mechanic']);
    expect(rolesOf({ roles: [], owner: true })).toEqual(['owner']);
    expect(mainRole({ roles: ['treasurer', 'office'], owner: false })).toBe('office');
    const s = computeChecklist(input({ roles: ['owner', 'office', 'treasurer'] }));
    expect(s.map((x) => x.id)).toEqual(['company', 'services', 'trucks', 'team', 'texts', 'cards', 'booking', 'customers', 'agenda', 'expense', 'report', 'tour']);
    expect(s[s.length - 1].role).toBe('owner');
  });
});
