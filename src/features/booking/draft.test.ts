import { describe, it, expect } from 'vitest';
import { reduce, initialDraft, plannedCars, otherCars, workOf, NO_CAR, EMPTY_PLACE, type Action, type Draft } from './draft';
import type { ItemDraft } from '../../domain/moment/logic';

const line = (description: string, unit_cents = 8999): ItemDraft => ({ kind: 'service', service_id: `s-${description}`, description, qty: 1, unit_cents, taxable: true, duration_min: 45 });
const place = (address: string) => ({ ...EMPTY_PLACE, address, lat: 45.5, lng: -73.6 });
let n = 0;
const mint = () => `job-${++n}`;
const run = (d: Draft, ...as: Action[]) => as.reduce(reduce, d);
const fresh = (o: Partial<Parameters<typeof initialDraft>[0]> = {}) =>
  initialDraft({ customerId: null, car: NO_CAR, place: EMPTY_PLACE, caller: { first: '', last: '', phone: '' }, callCar: null, choice: null, ...o });
const items = (d: Draft, key = d.car) => workOf(d, key).items.map((i) => i.description);
const mine = (cars: string[]) => (k: string) => cars.includes(k);

describe('the work typed before a car is chosen goes with the car (booking-a-01)', () => {
  it('two cars: services ticked, then a car tapped → the services are that car’s', () => {
    let d = fresh({ customerId: 'c-1', place: place('1 rue A') });
    d = run(d, { t: 'customerRow', id: 'c-1', cars: ['v-civic', 'v-rav4'], place: place('1 rue A'), card: false });
    expect(d.car).toBe(NO_CAR);
    d = run(d, { t: 'items', items: [line('Huile'), line('Freins')], mint: mint() }, { t: 'car', key: 'v-civic', mint: mint() });
    expect(items(d)).toEqual(['Huile', 'Freins']);
    expect(d.car).toBe('v-civic');
  });
  it('an estimate with no car, a customer with one car: the car is chosen and keeps the estimate’s lines and prices', () => {
    let d = fresh();
    d = run(d, { t: 'quote', customerId: 'c-1', vehicleId: null, items: [line('Rabais', -2000), line('Freins', 34999)], notes: null, mint: mint() });
    d = run(d, { t: 'customerRow', id: 'c-1', cars: ['v-only'], place: place('1 rue A'), card: false });
    expect(d.car).toBe('v-only');
    expect(workOf(d, 'v-only').items.map((i) => i.unit_cents)).toEqual([-2000, 34999]);
  });
  it('the lines of a car already chosen come after the ones typed on « no car » (nothing is lost)', () => {
    let d = fresh({ customerId: 'c-1' });
    d = run(d, { t: 'car', key: 'v-1', mint: mint() }, { t: 'items', items: [line('Huile')], mint: mint() }, { t: 'car', key: null, mint: mint() });
    d = run(d, { t: 'items', items: [line('Pneus')], mint: mint() }, { t: 'problem', text: 'bruit', mint: mint() }, { t: 'car', key: 'v-1', mint: mint() });
    expect(items(d)).toEqual(['Huile', 'Pneus']);
    expect(workOf(d, 'v-1').problem).toBe('bruit');
    expect(workOf(d, NO_CAR).items).toEqual([]);
  });
  it('between two cars, each keeps its own work (as before)', () => {
    let d = fresh({ customerId: 'c-1', car: 'v-1' });
    d = run(d, { t: 'items', items: [line('Huile')], mint: mint() }, { t: 'car', key: 'v-2', mint: mint() });
    expect(items(d)).toEqual([]);
    d = run(d, { t: 'items', items: [line('Pneus')], mint: mint() }, { t: 'car', key: 'v-1', mint: mint() });
    expect(items(d)).toEqual(['Huile']);
    expect(items(d, 'v-2')).toEqual(['Pneus']);
  });
  it('a copied job with no car, for a one-car customer: its work goes onto that car', () => {
    let d = fresh();
    d = run(d, { t: 'copy', customerId: 'c-1', place: place('9 rue Copie'), fromJob: true, vehicleId: null, items: [line('Huile')], problem: 'fuite', notes: '', card: false, mint: mint() });
    d = run(d, { t: 'customerRow', id: 'c-1', cars: ['v-only'], place: place('1 rue A'), card: false });
    expect(d.car).toBe('v-only');
    expect(items(d)).toEqual(['Huile']);
    expect(d.place.address).toBe('9 rue Copie');
  });
});

describe('one job id per car, made once (booking-a-02)', () => {
  it('each car keeps its id whatever car is on screen; a booked car leaves the plan for good', () => {
    let d = fresh({ customerId: 'c-1', car: 'v-1' });
    d = run(d, { t: 'items', items: [line('Huile')], mint: 'id-v1' }, { t: 'problem', text: 'bruit', mint: 'ignored' },
      { t: 'car', key: 'v-2', mint: 'x' }, { t: 'items', items: [line('Pneus')], mint: 'id-v2' });
    const ids = () => Object.fromEntries(plannedCars(d, mine(['v-1', 'v-2'])).map((c) => [c.key, c.jobId]));
    expect(ids()).toEqual({ 'v-2': 'id-v2', 'v-1': 'id-v1' });
    // the first tap booked v-1 only (v-2 was refused): the retry sends v-2 alone, with its own id
    d = run(d, { t: 'booked', keys: ['v-1'], ids: ['id-v1'] });
    expect(ids()).toEqual({ 'v-2': 'id-v2' });
    // the form remembers what it booked (the estimate went with it)
    expect(d.bookedIds).toEqual(['id-v1']);
    // tapping the car that was booked does not bring it back with the old id
    d = run(d, { t: 'car', key: 'v-1', mint: 'y' });
    expect(ids()).toEqual({ 'v-2': 'id-v2' });
  });
});

describe('the problem is the car’s own (booking-a-06)', () => {
  it('a problem typed for one car is not written on the others, and a car with nothing gets no appointment', () => {
    let d = fresh({ customerId: 'c-1', car: 'v-b' });
    d = run(d, { t: 'items', items: [line('Freins')], mint: mint() }, { t: 'car', key: 'v-a', mint: mint() }, { t: 'car', key: 'v-b', mint: mint() },
      { t: 'problem', text: 'bruit à l’avant', mint: mint() });
    const plan = plannedCars(d, mine(['v-a', 'v-b']));
    expect(plan.map((c) => c.key)).toEqual(['v-b']);
    expect(plan[0].work.problem).toBe('bruit à l’avant');
  });
  it('the car on screen first, then the others in the order their work was typed', () => {
    let d = fresh({ customerId: 'c-1', car: 'v-1' });
    d = run(d, { t: 'items', items: [line('A')], mint: mint() }, { t: 'car', key: 'v-2', mint: mint() }, { t: 'items', items: [line('B')], mint: mint() },
      { t: 'car', key: 'v-3', mint: mint() }, { t: 'problem', text: 'C', mint: mint() });
    expect(plannedCars(d, mine(['v-1', 'v-2', 'v-3'])).map((c) => c.key)).toEqual(['v-3', 'v-1', 'v-2']);
    expect(otherCars(d, mine(['v-1', 'v-2', 'v-3'])).map((c) => c.key)).toEqual(['v-1', 'v-2']);
    // another customer's cars are never booked
    expect(plannedCars(d, mine(['v-3'])).map((c) => c.key)).toEqual(['v-3']);
  });
});

describe('« C’est lui » keeps what was said during the call (booking-a-05)', () => {
  const call = () => run(fresh({ callCar: { id: 'call-1', draft: { year: '', make: '', model: '', vin: '', extra: {} }, mode: 'ymm' }, car: 'call-1' }),
    { t: 'place', place: place('99 rue Typed') }, { t: 'items', items: [line('Huile')], mint: 'id-1' });
  it('the address typed stays; the work goes onto the customer’s only car', () => {
    let d = run(call(), { t: 'pickCustomer', id: 'c-julie' });
    d = run(d, { t: 'customerRow', id: 'c-julie', cars: ['v-julie'], place: place('1 rue A'), card: true });
    expect(d.place.address).toBe('99 rue Typed');
    expect(d.placeOwner).toBe('c-julie');
    expect(d.car).toBe('v-julie');
    expect(items(d)).toEqual(['Huile']);
    expect(d.card).toBe(true);
  });
  it('nothing typed: the file’s address', () => {
    let d = run(fresh({ callCar: { id: 'call-1', draft: { year: '', make: '', model: '', vin: '', extra: {} }, mode: 'ymm' }, car: 'call-1' }), { t: 'pickCustomer', id: 'c-julie' });
    d = run(d, { t: 'customerRow', id: 'c-julie', cars: ['v-1', 'v-2'], place: place('1 rue A'), card: false });
    expect(d.place.address).toBe('1 rue A');
    expect(d.car).toBe(NO_CAR);
  });
  it('another customer chosen instead of the first: the address of the new one’s file (as before)', () => {
    let d = fresh({ customerId: 'c-a', place: place('1 rue A') });
    d = run(d, { t: 'place', place: place('2 rue changée') }, { t: 'pickCustomer', id: 'c-b' }, { t: 'customerRow', id: 'c-b', cars: [], place: place('3 rue B'), card: false });
    expect(d.place.address).toBe('3 rue B');
  });
  it('back to nobody: a new caller is back on their first car, with the work on screen', () => {
    let d = run(call(), { t: 'pickCustomer', id: 'c-julie' }, { t: 'customerRow', id: 'c-julie', cars: ['v-julie'], place: place('1 rue A'), card: false });
    d = run(d, { t: 'pickCustomer', id: null });
    expect(d.car).toBe('call-1');
    expect(items(d)).toEqual(['Huile']);
    expect(d.place).toEqual(EMPTY_PLACE);
  });
});

describe('the new caller’s own file, made by a refused first try (booking-a-09)', () => {
  const made = () => run(fresh({ callCar: { id: 'call-1', draft: { year: '', make: '', model: '', vin: '', extra: {} }, mode: 'ymm' }, car: 'call-1' }),
    { t: 'place', place: place('99 rue Typed') }, { t: 'items', items: [line('Huile')], mint: 'id-1' }, { t: 'made', customerId: 'c-new', cars: ['call-1'] },
    { t: 'customerRow', id: 'c-new', cars: ['call-1'], place: place('99 rue Typed'), card: false });
  it('« Changer » back to the caller to fix the number: the address said during the call stays', () => {
    const d = run(made(), { t: 'pickCustomer', id: null });
    expect(d.customerId).toBeNull();
    expect(d.place.address).toBe('99 rue Typed');
    expect(d.placeFrom).toBe('typed');
    expect(d.car).toBe('call-1');
    expect(items(d)).toEqual(['Huile']);
  });
  it('then « C’est lui » on another file: the address said stays too (as for any caller)', () => {
    let d = run(made(), { t: 'pickCustomer', id: null }, { t: 'pickCustomer', id: 'c-julie' });
    d = run(d, { t: 'customerRow', id: 'c-julie', cars: ['v-julie'], place: place('1 rue A'), card: false });
    expect(d.place.address).toBe('99 rue Typed');
  });
  it('a customer this form did not make: the address goes with them (as before)', () => {
    const d = run(fresh({ customerId: 'c-a', place: place('1 rue A') }), { t: 'place', place: place('2 rue changée') }, { t: 'pickCustomer', id: null });
    expect(d.place).toEqual(EMPTY_PLACE);
    expect(d.placeFrom).toBe('none');
  });
});

describe('a new caller’s cars', () => {
  const two = () => {
    let d = fresh({ callCar: { id: 'call-1', draft: { year: '', make: '', model: '', vin: '', extra: {} }, mode: 'ymm' }, car: 'call-1' });
    d = run(d, { t: 'items', items: [line('Huile')], mint: 'id-1' }, { t: 'addCallCar', id: 'call-2', mint: 'id-2' }, { t: 'items', items: [line('Pneus')], mint: 'x' });
    return d;
  };
  it('« Ajouter une autre voiture »: a fresh car, the first keeps its work', () => {
    const d = two();
    expect(d.car).toBe('call-2');
    expect(items(d, 'call-1')).toEqual(['Huile']);
    expect(plannedCars(d, mine(['call-1', 'call-2'])).map((c) => c.jobId)).toEqual(['id-2', 'id-1']);
  });
  it('« Retirer cette voiture »: its work goes too, the first car is shown', () => {
    const d = run(two(), { t: 'removeCallCar' });
    expect(d.callCars.map((c) => c.id)).toEqual(['call-1']);
    expect(d.car).toBe('call-1');
    expect(d.work['call-2']).toBeUndefined();
  });
  it('the file and the cars made: the screen has this customer, the car on screen kept when it was made', () => {
    expect(run(two(), { t: 'made', customerId: 'c-new', cars: ['call-1', 'call-2'] })).toMatchObject({ customerId: 'c-new', placeOwner: 'c-new', car: 'call-2' });
    const d = run(two(), { t: 'made', customerId: 'c-new', cars: ['call-1'] });
    expect(d.car).toBe(NO_CAR);
    expect(items(d)).toEqual(['Pneus']);
  });
});

describe('the moment', () => {
  const block = { day: '2026-11-18', block: 'am' as const };
  const win = { day: '2026-11-18', block: 'day' as const, win_start: 600, win_end: 840 };
  it('the address bar is read again when the mode arrives, unless the person picked', () => {
    expect(run(fresh({ choice: block }), { t: 'mode', windows: true, bar: win }).choice).toEqual(win);
    expect(run(fresh(), { t: 'choice', choice: block }, { t: 'mode', windows: false, bar: null }).choice).toEqual(block);
  });
  it('a moment of the other mode can no longer be booked: it is taken off (x-dualmode-11)', () => {
    expect(run(fresh(), { t: 'choice', choice: block }, { t: 'mode', windows: true, bar: null }).choice).toBeNull();
    expect(run(fresh(), { t: 'choice', choice: win }, { t: 'mode', windows: false, bar: null }).choice).toBeNull();
  });
  it('a window refused (window_full): the choice goes, the picker asks again, the reason stays above it', () => {
    const d = run(fresh(), { t: 'choice', choice: win }, { t: 'refused', banner: 'plus possible', windowGone: true });
    expect(d).toMatchObject({ choice: null, blockError: 'plus possible', reload: 1 });
  });
  it('a block refused (block_full, truck_full…): the choice stays with the reason, the picker asks again (R79)', () => {
    const d = run(fresh(), { t: 'choice', choice: block }, { t: 'refused', banner: 'Ce bloc est plein.', again: true });
    expect(d).toMatchObject({ choice: block, blockError: 'Ce bloc est plein.', reload: 1 });
    // a reason without a new question (an old caller): the picker is left alone
    expect(run(fresh(), { t: 'choice', choice: block }, { t: 'refused', banner: 'x' })).toMatchObject({ choice: block, blockError: 'x', reload: 0 });
  });
  it('a copy’s window is a default: a moment already picked stays', () => {
    expect(run(fresh(), { t: 'presetChoice', choice: win }).choice).toEqual(win);
    expect(run(fresh(), { t: 'choice', choice: block }, { t: 'presetChoice', choice: win }).choice).toEqual(block);
  });
});
