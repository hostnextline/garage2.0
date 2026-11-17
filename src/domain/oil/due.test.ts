import { describe, it, expect } from 'vitest';
import { dueDay, isOilItem, isOilStock, lastOilOf, oilJobIds, oilOnlyAdded, oilRows, oilWords, toCall, type OilInput } from './due';
import type { InventoryItem, InventoryMove } from '../../data/types';
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
    // a service line reworded by hand, a service whose name does not say it
    expect(isOilItem(item('j', 's-tires', 'Pneus + vidange'), m)).toBe(true);
    expect(isOilItem(item('j', 's-none', 'Vidange'), m)).toBe(false);
  });
  it('does not count work refused, taken off or only proposed', () => {
    for (const s of ['declined', 'removed', 'proposed'] as const) expect(isOilItem(item('j', 's-oil', '', s), m)).toBe(false);
    expect(isOilItem(item('j', 's-oil', '', 'planned'), m)).toBe(true);
  });
});

describe('oilWords', () => {
  it('an oil change, however it is worded', () => {
    for (const w of ['Changement d’huile (5 L)', 'changement d\'huile', 'Vidange', 'Vidange d’huile et filtre', 'Vidange moteur', 'Huile et filtre', 'Huile synthétique', 'Oil change', 'Oil & filter', 'OIL CHANGE + FILTER',
      'Lube, oil and filter', 'LOF', 'Lube', '5W-30 synthétique 5 L', '0w20', 'Synthetic 5 qt', 'Full synthetic service', 'Pneus + huile', 'Promo : pneus non montés + huile + inspection',
      'Fuite de transmission + changement d’huile', 'Brakes and oil change', 'Entretien : vidange, filtre à air']) expect(oilWords(w), w).toBe(true);
  });
  it('not another fluid, a leak, a part or other work', () => {
    for (const w of ['Vidange de transmission', 'Huile à transmission', 'Transmission oil change', 'Vidange du liquide de frein', 'Brake fluid flush', 'Vidange du liquide de refroidissement', 'Coolant flush',
      'Fuite d’huile : diagnostic', 'Oil leak diagnostic', 'Oil pan gasket', 'Joint de carter d’huile', 'Capteur de pression d’huile', 'Oil pressure sensor', 'Huile de différentiel', 'Power steering oil',
      'Changement de pneus (déjà montés)', 'Freins avant', 'Diagnostic (30 min)', 'Top up des liquides', 'Inspection', 'Installation', 'Toile d’essuie-glace', '']) expect(oilWords(w), w).toBe(false);
  });
});

describe('oil only added or looked at is not an oil change (x-branches-12, the garage2.0-niv correction)', () => {
  it('a top-up, a level check, a symptom', () => {
    for (const w of ['Ajout d’huile', 'Ajouter 1 L d’huile', 'Appoint d’huile', 'Vérifier le niveau d’huile', 'Vérification du niveau d’huile', 'Niveau d’huile', 'Top up huile', 'Oil top-up', 'Top off oil',
      'Oil level check', 'Check oil', 'Check oil level', 'Inspection huile', 'Témoin d’huile allumé', 'Lumière d’huile', 'Oil light on', 'Consomme de l’huile', 'Burns oil', 'Odeur d’huile brûlée', 'Diagnostic huile',
      'Remplissage d’huile', 'Ajout 5W-30']) { expect(oilWords(w), w).toBe(false); expect(oilOnlyAdded(w), w).toBe(true); }
  });
  it('still one when the same words say the oil is changed, or another piece of the line does', () => {
    for (const w of ['Changement d’huile (ajout de 5 L)', 'Vidange et vérification des niveaux', 'Oil change, check brakes', 'Vérifier les freins + changement d’huile', 'Check engine light + oil change',
      'Changement d’huile avec vérification du niveau', 'Remplacement de l’huile', 'Top up des liquides + vidange']) { expect(oilWords(w), w).toBe(true); expect(oilOnlyAdded(w), w).toBe(false); }
  });
  it('a top-up taken from the stock does not count: under 3 litres, or a line that says the oil was only added', () => {
    const stock = [{ id: 'i-l', name: 'Huile 5W-30', category: 'Huile', unit: 'L' }, { id: 'i-jug', name: 'Huile 5W-30 bidon', category: 'Huile', unit: 'bidon' }] as never[];
    const mv = (job_id: string, item_id: string, delta: number) => ({ id: `${job_id}${item_id}${delta}`, job_id, item_id, delta, reason: 'used' }) as never;
    const items = [item('j1', null, 'Entretien'), item('j2', null, 'Entretien'), item('j3', null, 'Ajout d’huile'), item('j4', null, 'Entretien'), item('j5', null, 'Entretien')];
    const ids = oilJobIds(items, SERVICES, [mv('j1', 'i-l', -1), mv('j2', 'i-l', -4.5), mv('j3', 'i-l', -5), mv('j4', 'i-jug', -1), mv('j5', 'i-l', -1.5), mv('j5', 'i-l', -2)], stock);
    expect([...ids].sort()).toEqual(['j2', 'j4', 'j5']);
  });
});

describe('the litres of stock oil (x-branches-25)', () => {
  const stock = [{ id: 'i-1l', name: 'Huile 5W-30 bouteille 1 L', category: 'Huile', unit: 'unité' }, { id: 'i-5l', name: 'Huile 5W-30 bidon 5 L', category: 'Huile', unit: 'unité' }] as never[];
  const mv = (job_id: string, item_id: string, delta: number) => ({ id: `${job_id}${item_id}${delta}`, job_id, item_id, delta, reason: 'used' }) as never;
  const sell = (job_id: string, item_id: string, qty: number) => ({ ...item(job_id, null, 'Huile'), id: `${job_id}-${item_id}`, kind: 'part', item_id, qty, description: 'Bouteille' }) as never;
  it('a bottle of 1 L whose unit is « unité » is read from its name: a top-up', () => {
    expect([...oilJobIds([item('j1', null, 'Freins')], SERVICES, [mv('j1', 'i-1l', -1)], stock)]).toEqual([]);
    expect([...oilJobIds([item('j1', null, 'Freins')], SERVICES, [mv('j1', 'i-5l', -1)], stock)]).toEqual(['j1']);
  });
  it('the oil sold on the lines and the same oil taken at the end are not added twice', () => {
    // 2 bottles sold, the same 2 taken at the end: 2 L, not 4
    expect([...oilJobIds([sell('j1', 'i-1l', 2)], SERVICES, [mv('j1', 'i-1l', -2)], stock)]).toEqual([]);
    // a coming job: only its lines are known
    expect([...oilJobIds([sell('j2', 'i-1l', 4)], SERVICES, [], stock)]).toEqual(['j2']);
  });
});

describe('words that are not an engine oil change (customers-b-04)', () => {
  it('another fluid named elsewhere in the line, gear oil, parts, grease, a reset', () => {
    for (const w of ['Vidange et remplissage de transmission', 'Vidange et remplissage du différentiel', 'Transmission : vidange', 'Freins : vidange du liquide', '75W-90', 'Huile 75W-90',
      'Bouchon de vidange', 'Jauge d’huile', 'Boîtier de filtre à huile', 'Oil filter housing gasket', 'Graisse synthétique', 'Reset oil life']) expect(oilWords(w), w).toBe(false);
  });
  it('stock filed under « Huile » that is not engine oil', () => {
    for (const it of [{ name: 'ATF Dexron VI', category: 'Huile' }, { name: 'Huile 75W-90', category: 'Huiles' }, { name: 'Huile 2 temps', category: 'Huile' }, { name: 'Lave-glace -40', category: 'Huile et liquides' }]) expect(isOilStock(it), it.name).toBe(false);
    expect(isOilStock({ name: 'Mobil 1 0W-20', category: 'Huile' })).toBe(true);
  });
});

describe('a person says « no oil change at this visit »', () => {
  const jobs = [job('j0', 'v1', '2026-06-01'), job('j1', 'v1', '2026-12-01')];
  const items = [item('j0', 's-oil'), item('j1', 's-oil')];
  it('the visit no longer counts; the one before does; said again, it counts again', () => {
    const before = oilRows(input({ jobs, items }));
    expect(before[0]).toMatchObject({ lastOil: '2026-12-01', oilJob: 'j1', lastVisitJob: 'j1', lastVisitDenied: false, due: '2027-06-01' });
    const denied = oilRows(input({ jobs, items, vehicles: [car('v1', 'c1', { oil_followup: { not_oil: ['j1'] } as never })] }));
    expect(denied[0]).toMatchObject({ lastOil: '2026-06-01', oilJob: 'j0', lastVisit: '2026-12-01', lastVisitDenied: true, due: '2027-03-01', mark: null });
    expect(lastOilOf(car('v1', 'c1', { oil_followup: { not_oil: ['j1'] } as never }), { today: TODAY, jobs, items, services: SERVICES })).toEqual({ day: '2026-06-01', ours: true });
    const both = oilRows(input({ jobs, items, vehicles: [car('v1', 'c1', { oil_followup: { not_oil: ['j0', 'j1'] } as never })] }));
    expect(both[0]).toMatchObject({ lastOil: null, oilJob: null, due: '2027-03-01' });
  });
  it('it lives beside a call noted, and is not itself a call', () => {
    const rows = oilRows(input({ jobs, items, vehicles: [car('v1', 'c1', { oil_followup: { at: '2027-06-10T15:00:00.000Z', again_on: '2027-06-24', not_oil: ['j1'] } as never })] }));
    expect(rows[0]).toMatchObject({ lastOil: '2026-06-01', callOn: '2027-06-24', state: 'soon' });
    expect(rows[0].mark?.again_on).toBe('2027-06-24');
  });
  it('the day the customer gave is told apart from ours', () => {
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2026-12-01')], items: [item('j1', 's-tires')], vehicles: [car('v1', 'c1', { last_oil_on: '2026-12-01' })] }));
    expect(rows[0]).toMatchObject({ lastOil: '2026-12-01', oilJob: null, saidOn: '2026-12-01' });
  });
});

describe('appointments booked without a car (customers-b-03)', () => {
  it('a customer with one car: the visit counts for that car', () => {
    const rows = oilRows(input({ jobs: [job('j0', 'v1', '2026-06-01'), job('j1', null, '2027-05-01')], items: [item('j0', 's-tires'), item('j1', 's-oil')] }));
    expect(rows[0]).toMatchObject({ key: 'v1', lastOil: '2027-05-01', due: '2027-11-01', state: 'later' });
    expect(lastOilOf(car('v1', 'c1'), { today: TODAY, jobs: [job('j1', null, '2027-05-01')], items: [item('j1', 's-oil')], services: SERVICES, vehicles: [car('v1', 'c1')] })).toEqual({ day: '2027-05-01', ours: true });
  });
  it('several cars: a coming oil change booked without a car takes them off the list; another coming visit shows on each', () => {
    const vehicles = [car('v1', 'c1'), car('v2', 'c1')];
    const done = [job('j1', 'v1', '2026-12-01'), job('j2', 'v2', '2026-11-01')];
    const oil = oilRows(input({ vehicles, jobs: [...done, job('j3', null, '2027-06-20', 'booked')], items: [item('j1', 's-oil'), item('j2', 's-oil'), item('j3', 's-oil', '', 'planned')] }));
    expect(oil).toHaveLength(0);
    const other = oilRows(input({ vehicles, jobs: [...done, job('j3', null, '2027-06-20', 'booked')], items: [item('j1', 's-oil'), item('j2', 's-oil'), item('j3', 's-tires', '', 'planned')] }));
    expect(other.map((r) => [r.key, r.next?.jobId])).toEqual([['v2', 'j3'], ['v1', 'j3']]);
  });
  it('several cars none of which came: a coming oil change booked without a car also takes the visits with no car off the list (review oil-nocar-coming)', () => {
    const vehicles = [car('v1', 'c1'), car('v2', 'c1')];
    const past = job('j1', null, '2026-12-01');
    const oil = oilRows(input({ vehicles, jobs: [past, job('j2', null, '2027-06-20', 'booked')], items: [item('j1', 's-oil'), item('j2', 's-oil', '', 'planned')] }));
    expect(oil).toEqual([]);
    // a coming visit without an oil change: still listed, with that visit as the next one
    const other = oilRows(input({ vehicles, jobs: [past, job('j2', null, '2027-06-20', 'booked')], items: [item('j1', 's-oil'), item('j2', 's-tires', '', 'planned')] }));
    expect(other.map((r) => [r.key, r.state, r.next?.jobId])).toEqual([['c:c1', 'call', 'j2']]);
  });
});

describe('the stock', () => {
  const stock = [{ id: 'i-oil', name: 'Huile 5W-30 synthétique', category: 'Huile' }, { id: 'i-oil2', name: '0W-20 Castrol', category: null }, { id: 'i-fil', name: 'Filtre à l’huile PH7317', category: 'Filtres' },
    { id: 'i-atf', name: 'Huile à transmission ATF', category: 'Huile' }, { id: 'i-pad', name: 'Plaquettes avant', category: 'Freins' }] as unknown as InventoryItem[];
  const move = (job_id: string, item_id: string, delta = -5, reason = 'used') => ({ id: `${job_id}-${item_id}`, job_id, item_id, delta, reason }) as InventoryMove;
  it('knows engine oil among the parts', () => {
    expect(stock.map((s) => isOilStock(s))).toEqual([true, true, false, false, false]);
  });
  it('a job that took engine oil from the stock had an oil change, whatever its lines say', () => {
    const items = [item('j1', null, 'Entretien complet'), item('j2', null, 'Entretien complet'), item('j3', null, 'Freins'), item('j4', null, 'Entretien')];
    const ids = oilJobIds(items, SERVICES, [move('j1', 'i-oil'), move('j2', 'i-atf'), move('j3', 'i-pad'), move('j4', 'i-oil', 5, 'restock')], stock);
    expect([...ids]).toEqual(['j1']);
    const sold = oilJobIds([{ ...item('j5', null, 'Bidon'), kind: 'part', item_id: 'i-oil2', qty: 1 } as never], SERVICES, [], stock);
    expect([...sold]).toEqual(['j5']);
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2027-03-01')], items: [items[0]], moves: [move('j1', 'i-oil')], stock }));
    expect(rows[0]).toMatchObject({ lastOil: '2027-03-01', due: '2027-09-01' });
  });
  it('a jug of oil sold on a line still counts when « Pièces utilisées » hold only the filter (review oil-used-any-move)', () => {
    const jug = { ...item('j9', null, 'Bidon Mobil 1'), kind: 'part', item_id: 'i-oil', qty: 1 } as never;
    expect([...oilJobIds([jug], SERVICES, [], stock)]).toEqual(['j9']);
    expect([...oilJobIds([jug], SERVICES, [move('j9', 'i-fil', -1)], stock)]).toEqual(['j9']);
    // the oil really taken still wins over the lines when it is recorded: 5 L sold but 1 L taken is a top-up
    const litres = [{ ...stock[0], unit: 'L' } as InventoryItem, stock[2]];
    const five = { ...item('j8', null, 'Mobil 1'), kind: 'part', item_id: 'i-oil', qty: 5 } as never;
    expect([...oilJobIds([five], SERVICES, [move('j8', 'i-fil', -1)], litres)]).toEqual(['j8']);
    expect([...oilJobIds([five], SERVICES, [move('j8', 'i-fil', -1), move('j8', 'i-oil', -1)], litres)]).toEqual([]);
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
  it('R169: the day of a call is Montréal’s, whatever the phone’s zone', () => {
    // noted at 20:30 in Montréal the evening BEFORE the visit (01:30 the next day in UTC, 10:30 in Tokyo): an old call
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2026-12-02')], items: [item('j1', 's-oil')], vehicles: [car('v1', 'c1', { oil_followup: { at: '2026-12-02T01:30:00.000Z', stop: true } })] }));
    expect(rows[0]).toMatchObject({ mark: null });
    expect(rows[0].state).not.toBe('stopped');
    // noted at 21:30 in Montréal the day of the visit (the next day in UTC): it counts
    const same = oilRows(input({ jobs: [job('j1', 'v1', '2026-12-01')], items: [item('j1', 's-oil')], vehicles: [car('v1', 'c1', { oil_followup: { at: '2026-12-02T02:30:00.000Z', stop: true } })] }));
    expect(same[0].state).toBe('stopped');
  });
  it('« do not call any more » keeps the car apart', () => {
    const rows = oilRows(input({ jobs: [job('j1', 'v1', '2026-12-01')], items: [item('j1', 's-oil')], vehicles: [car('v1', 'c1', { oil_followup: { at: '2027-06-10T15:00:00.000Z', stop: true } })] }));
    expect(rows[0].state).toBe('stopped');
    expect(toCall(rows)).toHaveLength(0);
  });
  // (changed with customers-b-03: this test used to keep a no-car visit of a one-car customer apart as « c:c1 »)
  it('a visit with no car counts only when none of the customer’s cars is followed', () => {
    const alone = oilRows(input({ vehicles: [], jobs: [job('j1', null, '2027-01-01')], items: [item('j1', 's-tires')] }));
    expect(alone[0]).toMatchObject({ key: 'c:c1', vehicleId: null, due: '2027-04-01' });
    const one = oilRows(input({ jobs: [job('j1', null, '2027-01-01')], items: [item('j1', 's-tires')] }));
    expect(one[0]).toMatchObject({ key: 'v1', vehicleId: 'v1', due: '2027-04-01' });
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
