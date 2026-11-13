import { describe, it, expect } from 'vitest';
import { dueDay, isOilItem, lastOilOf, oilRows, toCall, type OilInput } from './due';
import type { Customer, Job, JobItem, Service, Vehicle } from '../../data/types';

const TODAY = '2027-06-15';
const svc = (id: string, name_fr: string, needs: Service['needs'] = null) => ({ id, name_fr, name_en: null, includes: [], needs }) as unknown as Service;
const SERVICES = [svc('s-oil', 'Changement d’huile (5 L)'), svc('s-tires', 'Changement de pneus (déjà montés)'), svc('s-promo', 'Promo : pneus montés + huile'), svc('s-said', 'Entretien A', [{ kind: 'oil' }]), svc('s-none', 'Huile maison', [])];
const cust = (id: string, o: Partial<Customer> = {}) => ({ id, first_name: id, last_name: null, phone: '514 555-0100', ...o }) as Customer;
const car = (id: string, customer_id: string, o: Partial<Vehicle> = {}) => ({ id, customer_id, ...o }) as Vehicle;
const job = (id: string, vehicle_id: string | null, day: string, status: Job['status'] = 'done', customer_id = 'c1') => ({ id, vehicle_id, customer_id, day, status, block: 'am' }) as Job;
const item = (job_id: string, service_id: string | null, description = '', status: JobItem['status'] = 'done', kind: JobItem['kind'] = 'service') => ({ id: `${job_id}-${service_id || description}`, job_id, service_id, description, status, kind }) as JobItem;
const input = (o: Partial<OilInput>): OilInput => ({ today: TODAY, jobs: [], items: [], services: SERVICES, vehicles: [car('v1', 'c1')], customers: [cust('c1')], ...o });

describe('isOilItem', () => {
  const m = new Map(SERVICES.map((s) => [s.id, s]));
  it('knows an oil change by its service or its words', () => {
    expect(isOilItem(item('j', 's-oil'), m)).toBe(true);
    expect(isOilItem(item('j', 's-promo'), m)).toBe(true);
    expect(isOilItem(item('j', 's-said'), m)).toBe(true);
    expect(isOilItem(item('j', null, 'Oil change + filter'), m)).toBe(true);
    expect(isOilItem(item('j', 's-tires'), m)).toBe(false);
    expect(isOilItem(item('j', 's-none'), m)).toBe(false);
    expect(isOilItem(item('j', null, 'Fuite d’huile : diagnostic'), m)).toBe(false);
  });
  it('does not count work refused, taken off or only proposed', () => {
    for (const s of ['declined', 'removed', 'proposed'] as const) expect(isOilItem(item('j', 's-oil', '', s), m)).toBe(false);
    expect(isOilItem(item('j', 's-oil', '', 'planned'), m)).toBe(true);
  });
});

describe('dueDay', () => {
  it('6 months after an oil change, 3 months after a visit without', () => {
    expect(dueDay('2027-01-10', '2027-01-10')).toBe('2027-07-10');
    expect(dueDay('2027-01-10', null)).toBe('2027-04-10');
    expect(dueDay('2026-08-31', '2026-08-31')).toBe('2027-02-28');
  });
  it('a later visit without oil: 3 months after it, never before 6 months after the oil change', () => {
    expect(dueDay('2027-03-01', '2027-02-01')).toBe('2027-08-01');
    expect(dueDay('2027-06-01', '2026-06-01')).toBe('2027-09-01');
  });
});

describe('oilRows', () => {
  it('lists a car to call when its oil change is 6 months old', () => {
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2026-12-01')], items: [item('j1', 's-oil')] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'v1', customerId: 'c1', lastOil: '2026-12-01', due: '2027-06-01', state: 'call', late: 14 });
  });
  it('a visit without an oil change is due 3 months later', () => {
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2027-04-01')], items: [item('j1', 's-tires')] }));
    expect(rows[0]).toMatchObject({ lastOil: null, lastVisit: '2027-04-01', due: '2027-07-01', state: 'soon' });
  });
  it('soon within 30 days, later after', () => {
    const rows = oilRows(input({
      vehicles: [car('v1', 'c1'), car('v2', 'c1')],
      jobs: [job('j1', 'v1', '2027-01-10'), job('j2', 'v2', '2027-05-01')], items: [item('j1', 's-oil'), item('j2', 's-oil')]
    }));
    expect(rows.map((r) => [r.key, r.state])).toEqual([['v1', 'soon'], ['v2', 'later']]);
  });
  it('a coming appointment with an oil change takes the car off the list; one without is shown', () => {
    const base = { jobs: [job('j1', 'v1', '2026-12-01'), job('j2', 'v1', '2027-06-20', 'booked')], items: [item('j1', 's-oil'), item('j2', 's-oil', '', 'planned')] };
    expect(oilRows(input(base))).toHaveLength(0);
    const rows = oilRows(input({ ...base, items: [item('j1', 's-oil'), item('j2', 's-tires', '', 'planned')] }));
    expect(rows[0].next).toMatchObject({ jobId: 'j2', day: '2027-06-20' });
  });
  it('cancelled and missed visits do not count', () => {
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2026-12-01', 'cancelled'), job('j2', 'v1', '2026-12-02', 'no_show')], items: [item('j1', 's-oil'), item('j2', 's-oil')] }));
    expect(rows).toHaveLength(0);
  });
  it('« call back on »: waits until that day; a newer visit forgets it', () => {
    const jobs = [job('j1', 'v1', '2026-12-01')], items = [item('j1', 's-oil')];
    const mark = { at: '2027-06-10T15:00:00.000Z', again_on: '2027-06-24' };
    const waiting = oilRows(input({ jobs, items, vehicles: [car('v1', 'c1', { oil_followup: mark })] }));
    expect(waiting[0]).toMatchObject({ state: 'soon', callOn: '2027-06-24', due: '2027-06-01' });
    expect(toCall(waiting)).toHaveLength(0);
    const old = oilRows(input({ jobs: [job('j0', 'v1', '2026-05-01'), ...jobs], items, vehicles: [car('v1', 'c1', { oil_followup: { at: '2026-11-01T15:00:00.000Z', stop: true } })] }));
    expect(old[0]).toMatchObject({ state: 'call', mark: null });
  });
  it('« do not call any more » keeps the car apart', () => {
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2026-12-01')], items: [item('j1', 's-oil')], vehicles: [car('v1', 'c1', { oil_followup: { at: '2027-06-10T15:00:00.000Z', stop: true } })] }));
    expect(rows[0].state).toBe('stopped');
    expect(toCall(rows)).toHaveLength(0);
  });
  it('a visit with no car counts only when none of the customer’s cars is followed', () => {
    const alone = oilRows(input({ jobs: [job('j1', null, '2027-01-01')], items: [item('j1', 's-tires')] }));
    expect(alone[0]).toMatchObject({ key: 'c:c1', vehicleId: null, due: '2027-04-01' });
    const both = oilRows(input({ jobs: [job('j1', null, '2027-01-01'), job('j2', 'v1', '2027-02-01')], items: [] }));
    expect(both.map((r) => r.key)).toEqual(['v1']);
  });
  it('a car follows its owner of today; deleted cars and customers are left out', () => {
    const moved = oilRows(input({ customers: [cust('c1'), cust('c2')], vehicles: [car('v1', 'c2')], jobs: [job('j1', 'v1', '2026-12-01')], items: [item('j1', 's-oil')] }));
    expect(moved[0].customerId).toBe('c2');
    expect(oilRows(input({ vehicles: [car('v1', 'c1', { deleted_at: '2027-01-01' })], jobs: [job('j1', 'v1', '2026-12-01')] }))).toHaveLength(0);
    expect(oilRows(input({ customers: [cust('c1', { deleted_at: '2027-01-01' })], jobs: [job('j1', 'v1', '2026-12-01')] }))).toHaveLength(0);
  });
  it('the one waiting the longest comes first', () => {
    const rows = oilRows(input({
      vehicles: [car('v1', 'c1'), car('v2', 'c1')],
      jobs: [job('j1', 'v1', '2026-12-01'), job('j2', 'v2', '2026-10-01')], items: [item('j1', 's-oil'), item('j2', 's-oil')]
    }));
    expect(rows.map((r) => r.key)).toEqual(['v2', 'v1']);
  });
  it('« Dernier changement d’huile » said by the customer: 6 months after it, even before any visit', () => {
    const rows = oilRows(input({ vehicles: [car('v1', 'c1', { last_oil_on: '2026-12-10' })] }));
    expect(rows[0]).toMatchObject({ key: 'v1', lastOil: '2026-12-10', lastVisit: null, due: '2027-06-10', state: 'call', late: 5 });
    expect(oilRows(input({ vehicles: [car('v1', 'c1', { last_oil_on: '2027-07-01' })] }))).toHaveLength(0);
  });
  it('the latest of the day said and our own oil changes counts; a later visit without oil still waits 6 months after it', () => {
    const jobs = [job('j1', 'v1', '2027-03-01')];
    const ours = oilRows(input({ jobs, items: [item('j1', 's-oil')], vehicles: [car('v1', 'c1', { last_oil_on: '2026-10-01' })] }));
    expect(ours[0]).toMatchObject({ lastOil: '2027-03-01', due: '2027-09-01' });
    const said = oilRows(input({ jobs, items: [item('j1', 's-tires')], vehicles: [car('v1', 'c1', { last_oil_on: '2027-01-15' })] }));
    expect(said[0]).toMatchObject({ lastOil: '2027-01-15', lastVisit: '2027-03-01', due: '2027-07-15' });
    const newer = oilRows(input({ jobs, items: [item('j1', 's-tires')], vehicles: [car('v1', 'c1', { last_oil_on: '2027-04-01' })] }));
    expect(newer[0]).toMatchObject({ lastOil: '2027-04-01', due: '2027-10-01' });
  });
});

describe('lastOilOf', () => {
  const base = { today: TODAY, services: SERVICES, jobs: [job('j1', 'v1', '2027-03-01')], items: [item('j1', 's-oil')] };
  it('ours when it is the latest, else the day said, else nothing', () => {
    expect(lastOilOf(car('v1', 'c1', { last_oil_on: '2026-10-01' }), base)).toEqual({ day: '2027-03-01', ours: true });
    expect(lastOilOf(car('v1', 'c1', { last_oil_on: '2027-05-01' }), base)).toEqual({ day: '2027-05-01', ours: false });
    expect(lastOilOf(car('v2', 'c1'), base)).toBeNull();
    expect(lastOilOf(car('v2', 'c1', { last_oil_on: '2028-01-01' }), base)).toBeNull();
  });
});
