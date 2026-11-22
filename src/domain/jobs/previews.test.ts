/* The server previews as the sheets read them (« Vraies routes » on): « Changer de camion » (fitOf, from move_preview)
   and « Ordre des arrêts » (serverOrder, from stop_order_preview). Nothing of the phone's own is mixed in. */
import { describe, it, expect } from 'vitest';
import { fitOf, timesMeasured } from './move';
import { serverOrder } from './stopOrder';

describe('fitOf: can that truck take the appointment', () => {
  it('refused by the action → no; else yes with the arrival the server gives there', () => {
    expect(fitOf({ refused: ['j1'], eta: { j1: 700 }, unmeasured: 0 }, 'j1')).toEqual({ fits: false, eta: null, unmeasured: false });
    expect(fitOf({ refused: [], eta: { j1: 700, k: 600 }, unmeasured: 0 }, 'j1')).toEqual({ fits: true, eta: 700, unmeasured: false });
    expect(fitOf({ refused: ['other'], eta: {}, unmeasured: 0 }, 'j1')).toEqual({ fits: true, eta: null, unmeasured: false });
  });
  it('a trip of that day not measured: room, but no arrival said (it counts a fixed time for that trip: review M1)', () => {
    expect(fitOf({ refused: [], eta: { j1: 700 }, unmeasured: 2 }, 'j1')).toEqual({ fits: true, eta: null, unmeasured: true });
    // the server does not say (its switch off, an older server): no arrival either, no reason given
    expect(fitOf({ refused: [], eta: { j1: 700 }, unmeasured: null }, 'j1')).toEqual({ fits: true, eta: null, unmeasured: false });
    expect(fitOf({ refused: ['j1'], eta: {}, unmeasured: 3 }, 'j1')).toEqual({ fits: false, eta: null, unmeasured: false });
  });
  it('timesMeasured: only an answer that says every trip is measured', () => {
    expect(timesMeasured({ unmeasured: 0 })).toBe(true);
    expect(timesMeasured({ unmeasured: 1 })).toBe(false);
    expect(timesMeasured({ unmeasured: null })).toBe(false);
  });
  it('no answer: nothing said', () => { expect(fitOf(null, 'j1')).toBeNull(); });
  it('refused: why, when the server says it (refused_why, the code of move_job); another job’s code is not this one’s', () => {
    expect(fitOf({ refused: ['j1'], eta: {}, unmeasured: 0, refused_why: { j1: 'truck_full' } }, 'j1')).toStrictEqual({ fits: false, eta: null, unmeasured: false, why: 'truck_full' });
    expect(fitOf({ refused: ['j1'], eta: {}, unmeasured: 0, refused_why: { k: 'block_full' } }, 'j1')).toStrictEqual({ fits: false, eta: null, unmeasured: false });
  });
});

describe('serverOrder: the server’s arrivals and late ones, in the order on screen', () => {
  it('reads each stop and lists the late ones in the order shown (not the answer’s)', () => {
    const r = serverOrder([{ id: 'a', eta: 700, late: true }, { id: 'c', eta: 470, late: false }, { id: 'b', eta: 790, late: true }], ['b', 'c', 'a']);
    expect(r.late).toEqual(['b', 'a']);
    expect(r.byId.get('c')).toEqual({ eta: 470, late: false });
    expect(r.byId.get('z')).toBeUndefined();
  });
  it('a stop the server says is not measured: no arrival, never late (a guess); measured true or absent: as given', () => {
    const r = serverOrder([{ id: 'a', eta: 700, late: true, measured: false }, { id: 'b', eta: 790, late: true, measured: true }, { id: 'c', eta: 470, late: true }], ['c', 'a', 'b']);
    expect(r.byId.get('a')).toEqual({ eta: null, late: false, unmeasured: true });
    expect(r.byId.get('b')).toEqual({ eta: 790, late: true });
    expect(r.late).toEqual(['c', 'b']);
  });
  it('a stop the answer leaves out is neither timed nor late', () => {
    expect(serverOrder([], ['a']).late).toEqual([]);
  });
});
