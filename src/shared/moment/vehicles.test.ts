import { describe, it, expect } from 'vitest';
import { askedKind, bothKinds, fitsJob, kindOf } from './vehicles';
import { blockCell, cellMove } from './blockCells';

const car = { id: 'CAR', tire_machine: false };
const truck = { id: 'TRK', tire_machine: true };
const old = { id: 'OLD' };   // a vehicle saved before the switch existed: it has the machine

describe('the car or the truck', () => {
  it('a vehicle without the tire machine is the car; with it, or not said, the truck', () => {
    expect(kindOf([car, truck, old], 'CAR')).toBe('car');
    expect(kindOf([car, truck, old], 'TRK')).toBe('truck');
    expect(kindOf([car, truck, old], 'OLD')).toBe('truck');
    expect(bothKinds([car, truck])).toBe(true);
    expect(bothKinds([truck, old])).toBe(false);
  });
  it('which vehicles can take the job', () => {
    expect([car, truck].filter((x) => fitsJob(x, {})).map((x) => x.id)).toEqual(['CAR', 'TRK']);
    expect([car, truck].filter((x) => fitsJob(x, { need: true })).map((x) => x.id)).toEqual(['TRK']);
    expect([car, truck].filter((x) => fitsJob(x, { kind: 'car' })).map((x) => x.id)).toEqual(['CAR']);
    expect([car, truck].filter((x) => fitsJob(x, { kind: 'truck' })).map((x) => x.id)).toEqual(['TRK']);
    expect([car, truck].filter((x) => fitsJob(x, { truckId: 'CAR', kind: 'truck' })).map((x) => x.id)).toEqual(['CAR']);
  });
  // x-dualmode-07 / booking-b-02: the planner has no vehicle argument and plans the car first; a vehicle chosen by hand
  // asks the planner for ITS kind (before: the kind of the switch, null), so the rows are that vehicle's
  it('a vehicle chosen by hand asks the planner for its own kind', () => {
    expect(askedKind({ truckId: 'TRK' }, [car, truck])).toBe('truck');
    expect(askedKind({ truckId: 'CAR', kind: 'truck' }, [car, truck])).toBe('car');
    // one kind only, an unknown vehicle, the tire machine: as before
    expect(askedKind({ truckId: 'TRK' }, [truck, old])).toBeNull();
    expect(askedKind({ truckId: 'GONE', kind: 'car' }, [car, truck])).toBe('car');
    expect(askedKind({ truckId: 'CAR', need: true }, [car, truck])).toBeNull();
    expect(askedKind({ kind: 'car' }, [car, truck])).toBe('car');
    expect(askedKind({}, [car, truck])).toBeNull();
  });
});

describe('the blocks calendar', () => {
  const lane = (id: string, left: number) => ({ truck: { id, tire_machine: id === 'CAR' ? false : true }, cap: 240, used: 240 - left, left, jobs: [] });
  // the car has the whole morning free, the truck 20 minutes
  const load = { trucks: [lane('CAR', 240), lane('TRK', 20)], open: true, started: false };
  // booking-b-06: a cell counted the room of every vehicle, so a tire-machine job saw the car's room (« 4 h ») and the
  // server refused it at « Réserver »
  it('only the vehicles that can take the job count', () => {
    expect(blockCell(load, 60, 20, { kinds: true })).toEqual({ state: 'ok', left: 240 });
    expect(blockCell(load, 60, 20, { kinds: true, need: true })).toEqual({ state: 'full', left: 20 });
    expect(blockCell(load, 60, 20, { kinds: true, kind: 'truck' })).toEqual({ state: 'full', left: 20 });
    expect(blockCell(load, 60, 20, { kinds: true, kind: 'car' })).toEqual({ state: 'ok', left: 240 });
    expect(blockCell(load, 60, 20, { kinds: true, truckId: 'TRK' })).toEqual({ state: 'full', left: 20 });
  });
  it('a garage with one kind: the kind asked changes nothing (as before)', () => {
    const one = { trucks: [lane('A', 240), lane('B', 20)], open: true, started: false };
    expect(blockCell(one, 60, 20, { kinds: false, kind: 'car' })).toEqual({ state: 'ok', left: 240 });
  });
  it('no vehicle of the kind works then: closed', () => {
    const onlyCar = { trucks: [lane('CAR', 240)], open: true, started: false };
    expect(blockCell(onlyCar, 60, 20, { kinds: true, need: true }).state).toBe('closed');
  });
  it('the arrows: right, left, a row down or up, the row’s ends, kept inside', () => {
    expect(cellMove(0, 'ArrowRight', 3, 6)).toBe(1);
    expect(cellMove(0, 'ArrowLeft', 3, 6)).toBe(0);
    expect(cellMove(1, 'ArrowDown', 3, 6)).toBe(4);
    expect(cellMove(4, 'ArrowDown', 3, 6)).toBe(5);
    expect(cellMove(4, 'ArrowUp', 3, 6)).toBe(1);
    expect(cellMove(4, 'Home', 3, 6)).toBe(3);
    expect(cellMove(3, 'End', 3, 6)).toBe(5);
    expect(cellMove(3, 'Enter', 3, 6)).toBeNull();
  });
});
