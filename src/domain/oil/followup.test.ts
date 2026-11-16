import { describe, it, expect } from 'vitest';
import { callOf, deniedJobs, followupOf, notOilOf, withCall, withNotOil, withoutNotOil } from './followup';

const car = (oil_followup: unknown) => ({ oil_followup }) as never;
const CALL = { at: '2027-06-10T15:00:00.000Z', by: 'u1', again_on: '2027-06-24' };

describe('what is kept about a car’s oil', () => {
  it('a call noted keeps the visits said to have had no oil change (another phone’s word is not lost)', () => {
    expect(withCall(car({ not_oil: ['j1'] }), CALL)).toEqual({ ...CALL, not_oil: ['j1'] });
    expect(withCall(car({ ...CALL, not_oil: ['j1'] }), null)).toEqual({ not_oil: ['j1'] });
    expect(withCall(car(CALL), null)).toBeNull();
  });
  it('« no oil change » keeps the call noted, once per visit, and can be taken back', () => {
    const one = withNotOil(car(CALL), 'j1');
    expect(one).toEqual({ ...CALL, not_oil: ['j1'] });
    expect(withNotOil(car(one), 'j1')).toEqual({ ...CALL, not_oil: ['j1'] });
    expect(withoutNotOil(car(one), 'j1')).toEqual(CALL);
    expect(withoutNotOil(car({ not_oil: ['j1'] }), 'j1')).toBeNull();
  });
  it('only a call back or a stop is a call; anything else stored is read safely', () => {
    expect(callOf(followupOf(car({ not_oil: ['j1'] })))).toBeNull();
    expect(callOf(followupOf(car({ at: CALL.at, stop: true })))).toEqual({ at: CALL.at, by: null, stop: true });
    expect(followupOf(car('nonsense'))).toBeNull();
    expect(notOilOf(car({ not_oil: ['j1', 3, null] }))).toEqual(['j1']);
    expect([...deniedJobs([car({ not_oil: ['j1'] }), car(null), car({ not_oil: ['j2'] })])]).toEqual(['j1', 'j2']);
  });
});
