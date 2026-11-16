import { describe, it, expect } from 'vitest';
import { secretsOf, ghlBody, dropAlert } from './secrets';

describe('Branchements: the keys and the switches', () => {
  it('a missing piece of the answer is « off »', () => {
    expect(secretsOf(null)).toEqual({ ghl: { on: false, token_end: null, location: null }, stripe: { on: false, test: false, end: null } });
    expect(secretsOf({ ghl: { on: true, token_end: 'ab12' } }).ghl).toEqual({ on: true, token_end: 'ab12', location: null });
  });
  it('GoHighLevel: only the boxes filled are sent; nothing typed sends nothing', () => {
    expect(ghlBody(' pit-1 ', '')).toEqual({ ghl_token: 'pit-1' });
    expect(ghlBody('', ' loc ')).toEqual({ ghl_location: 'loc' });
    expect(ghlBody(' ', '')).toBeNull();
  });
  it('the alert of the device is dropped only when calls AND texts are off (appel-notif)', () => {
    expect(dropAlert(false, false)).toBe(true);
    expect(dropAlert(false, true)).toBe(false);
    expect(dropAlert(true, false)).toBe(false);
  });
});
