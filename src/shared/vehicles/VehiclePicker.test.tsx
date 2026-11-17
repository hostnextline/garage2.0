/* The car chooser: the customer's only car is chosen by itself, once, where the screen holds a draft; never where
   autoPick={false} (a job writes on pick, customers-b-21); a car of ANOTHER customer left in the value (the customer
   was changed) is not this customer's car: it does not stop the only car from being chosen. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Vehicle } from '../../data/types';

const CARS = vi.hoisted(() => [] as Vehicle[]);
vi.mock('../../data/select', async (orig) => ({
  ...(await orig<typeof import('../../data/select')>()),
  vehiclesOf: (id: string) => CARS.filter((v) => v.customer_id === id)
}));

import { lang } from '../../lib/i18n';
import { VehiclePicker } from './VehiclePicker';

const box = document.createElement('div');
document.body.appendChild(box);
const car = (id: string, customer_id: string) => ({ id, customer_id, year: 2019, make: 'Honda', model: 'Civic' }) as Vehicle;

let picked: (string | null)[] = [];
beforeEach(() => { lang.value = 'fr'; picked = []; CARS.splice(0, CARS.length, car('v1', 'c1'), car('v2', 'c2')); });
afterEach(() => { act(() => render(null, box)); });
const draw = (customerId: string, value: string | null, autoPick?: boolean) =>
  act(() => render(<VehiclePicker customerId={customerId} value={value} onPick={(v) => picked.push(v)} autoPick={autoPick} />, box));

describe('« Véhicule »: the only car', () => {
  it('is chosen by itself when nothing is chosen', async () => {
    await draw('c2', null);
    expect(picked).toEqual(['v2']);
  });
  it('is not chosen again when it already is', async () => {
    await draw('c2', 'v2');
    expect(picked).toEqual([]);
  });
  it('is never chosen by itself with autoPick={false} (customers-b-21)', async () => {
    await draw('c2', null, false);
    expect(picked).toEqual([]);
  });
  it('a car of another customer left in the value does not count: this customer\'s car is chosen (customers-b-21)', async () => {
    await draw('c2', 'v1');
    expect(picked).toEqual(['v2']);
  });
});
