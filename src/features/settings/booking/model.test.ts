import { describe, it, expect, beforeEach } from 'vitest';
import { lang } from '../../../lib/i18n';
import { DEFAULT_SETTINGS } from '../../../data/select';
import type { Settings } from '../../../data/types';
import { viewOf, patchOf, check, planOf } from './model';
import { changesOf, withChanges } from '../draft';

const stored = (x: Record<string, unknown> = {}): Settings['booking'] => ({ ...DEFAULT_SETTINGS.booking, ...x } as Settings['booking']);
beforeEach(() => { lang.value = 'fr'; });

describe('Réservations: only what was changed is written (settings-team-01)', () => {
  it('a draft on the horizon, the start moved meanwhile on another device: only the horizon is sent, the new start stays', () => {
    const before = stored();
    const mine = changesOf(viewOf(before), { ...viewOf(before), horizon_days: 90 });
    const now = stored({ home: { label: 'Centrale', address: '1401 rue Legendre O.', lat: 45.53, lng: -73.65 } });
    const patch = patchOf(changesOf(viewOf(now), withChanges(viewOf(now), mine)), now, false);
    expect(patch).toEqual({ horizon_days: 90 });
    expect({ ...now, ...patch }.home.address).toBe('1401 rue Legendre O.');
  });
  it('the name of the start alone keeps the address stored now; the address alone keeps the name', () => {
    const b = stored({ home: { label: 'Centrale', address: 'A', lat: 1, lng: 2 } });
    expect(patchOf({ label: ' Garage ' }, b, false)).toEqual({ home: { label: 'Garage', address: 'A', lat: 1, lng: 2 } });
    expect(patchOf({ place: { address: 'B ', lat: 3, lng: 4 } }, b, false)).toEqual({ home: { label: 'Centrale', address: 'B', lat: 3, lng: 4 } });
  });
  it('the detour is stored as a factor; numbers are whole minutes; an empty return number is none', () => {
    expect(patchOf({ detour_pct: 33, stop_min: 5.4, return_phone: '  ' }, stored(), false)).toEqual({ detour: 1.33, stop_min: 5, return_phone: null });
  });
  it('the window numbers are written only once the garage books by windows', () => {
    expect(patchOf({ win_before_min: 30 }, stored(), false)).toEqual({});
    expect(patchOf({ win_before_min: 30, win_round_min: 45 }, stored(), true)).toEqual({ win_before_min: 30, win_round_min: 60 });
  });
});

describe('Réservations: garde-route limits, 0 = no limit (settings-team-10)', () => {
  it('a stored 0 is shown 0, and saving something else does not turn it back to 35 / 105', () => {
    const b = stored({ max_hop_min: 0, max_day_drive_min: 0 });
    const v = viewOf(b);
    expect([v.max_hop_min, v.max_day_drive_min]).toEqual([0, 0]);
    const patch = patchOf(changesOf(v, { ...v, horizon_days: 90 }), b, false);
    expect({ ...b, ...patch }.max_hop_min).toBe(0);
    expect({ ...b, ...patch }.max_day_drive_min).toBe(0);
  });
  it('missing: the usual 35 and 105', () => {
    const b = stored({ max_hop_min: undefined, max_day_drive_min: undefined });
    expect([viewOf(b).max_hop_min, viewOf(b).max_day_drive_min]).toEqual([35, 105]);
  });
  it('0 can be typed and saved; under the minimum (but not 0) is refused', () => {
    const v = { ...viewOf(stored()), max_hop_min: 0, max_day_drive_min: 0 };
    expect(check(v, { winOn: false, placeChanged: false }).errors).toEqual({});
    expect(patchOf({ max_hop_min: 0 }, stored(), false)).toEqual({ max_hop_min: 0 });
    expect(Object.keys(check({ ...v, max_hop_min: 5 }, { winOn: false, placeChanged: false }).errors)).toEqual(['max_hop_min']);
  });
});

describe('Réservations: the start needs its position (settings-team-04)', () => {
  it('a start typed without a position is refused; with one it goes', () => {
    const v = viewOf(stored());
    expect(check({ ...v, place: { address: '12 rue Inconnue', lat: null, lng: null } }, { winOn: false, placeChanged: true }).errors.place).toContain('suggestions');
    expect(check({ ...v, place: { address: '1401 Legendre', lat: 45.5, lng: -73.6 } }, { winOn: false, placeChanged: true }).errors).toEqual({});
  });
  it('an old start without position does not block saving another field', () => {
    const v = { ...viewOf(stored()), place: { address: 'old', lat: null, lng: null } };
    expect(check(v, { winOn: false, placeChanged: false }).errors).toEqual({});
  });
  it('the blocks: an end before its start, or over the block before, is refused', () => {
    const v = viewOf(stored());
    expect(check({ ...v, blocks: [{ key: 'am', start: 600, end: 540 }, v.blocks[1], v.blocks[2]] }, { winOn: false, placeChanged: false }).blocks).toBe(true);
    expect(check(v, { winOn: false, placeChanged: false }).blocks).toBe(false);
  });
});

describe('Réservations: what re-plans', () => {
  it('the position and the numbers of the estimate re-plan; the name and the horizon do not', () => {
    const v = viewOf(stored());
    expect(planOf({ ...v, label: 'Garage' })).toBe(planOf(v));
    expect(planOf({ ...v, horizon_days: 30 })).toBe(planOf(v));
    expect(planOf({ ...v, speed_kmh: 40 })).not.toBe(planOf(v));
    expect(planOf({ ...v, place: { ...v.place, lat: 45.6 } })).not.toBe(planOf(v));
  });
});
