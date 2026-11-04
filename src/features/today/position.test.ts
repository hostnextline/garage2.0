import { describe, it, expect } from 'vitest';
import { shouldSend, metersBetween, currentJobId, agoText, RULES, type Fix, type Sent } from './position';
import { lang } from '../../lib/i18n';

const T0 = Date.UTC(2026, 10, 4, 15, 0, 0);
const HOME = { lat: 45.5005053, lng: -73.6577429 };
/** a point about `m` metres north of HOME */
const north = (m: number) => ({ lat: HOME.lat + m / 111_195, lng: HOME.lng });
const fix = (p: { lat: number; lng: number }, at = T0, accuracy: number | null = 10): Fix => ({ ...p, accuracy, at });
const sent = (p: { lat: number; lng: number }, at: number, jobId: string | null = null): Sent => ({ ...p, at, jobId });

describe('distance', () => {
  it('measures metres on the ground', () => {
    expect(metersBetween(HOME, HOME)).toBe(0);
    expect(metersBetween(HOME, north(25))).toBeCloseTo(25, 0);
    // the Centrale to the corner of Décarie and Jean-Talon, about 1.5 km
    expect(metersBetween(HOME, { lat: 45.4955, lng: -73.6773 })).toBeGreaterThan(1400);
    expect(metersBetween(HOME, { lat: 45.4955, lng: -73.6773 })).toBeLessThan(1700);
  });
});

describe('when to send the position', () => {
  it('sends the first reading at once', () => {
    expect(shouldSend(null, fix(HOME), null, T0)).toBe(true);
  });
  it('standing still: once a minute', () => {
    const last = sent(HOME, T0);
    expect(shouldSend(last, fix(HOME, T0 + 20_000), null, T0 + 20_000)).toBe(false);
    expect(shouldSend(last, fix(HOME, T0 + 59_000), null, T0 + 59_000)).toBe(false);
    expect(shouldSend(last, fix(HOME, T0 + 60_000), null, T0 + 60_000)).toBe(true);
  });
  it('moving: sooner, once past 25 m', () => {
    const last = sent(HOME, T0);
    expect(shouldSend(last, fix(north(24), T0 + 15_000), null, T0 + 15_000)).toBe(false);
    expect(shouldSend(last, fix(north(26), T0 + 15_000), null, T0 + 15_000)).toBe(true);
  });
  it('driving: never more often than every 10 s', () => {
    const last = sent(HOME, T0);
    expect(shouldSend(last, fix(north(150), T0 + 2_000), null, T0 + 2_000)).toBe(false);
    expect(shouldSend(last, fix(north(150), T0 + RULES.minGapMs - 1), null, T0 + RULES.minGapMs - 1)).toBe(false);
    expect(shouldSend(last, fix(north(150), T0 + RULES.minGapMs), null, T0 + RULES.minGapMs)).toBe(true);
  });
  it('a new job (« Je pars », « Je suis arrivé ») goes out without waiting for the minute', () => {
    const last = sent(HOME, T0, 'j-1');
    expect(shouldSend(last, fix(HOME, T0 + 12_000), 'j-2', T0 + 12_000)).toBe(true);
    expect(shouldSend(last, fix(HOME, T0 + 12_000), null, T0 + 12_000)).toBe(true);
    expect(shouldSend(last, fix(HOME, T0 + 12_000), 'j-1', T0 + 12_000)).toBe(false);
    // still not faster than the floor
    expect(shouldSend(last, fix(HOME, T0 + 3_000), 'j-2', T0 + 3_000)).toBe(false);
  });
  it('a vague reading (cell towers) never counts as moving, only the minute', () => {
    const last = sent(HOME, T0);
    expect(shouldSend(last, fix(north(400), T0 + 20_000, 1500), null, T0 + 20_000)).toBe(false);
    expect(shouldSend(last, fix(north(400), T0 + 60_000, 1500), null, T0 + 60_000)).toBe(true);
    // an unknown accuracy is trusted
    expect(shouldSend(last, fix(north(40), T0 + 20_000, null), null, T0 + 20_000)).toBe(true);
  });
  it('an old reading is not where the person is now', () => {
    expect(shouldSend(null, fix(HOME, T0 - RULES.staleMs - 1), null, T0)).toBe(false);
    expect(shouldSend(null, fix(HOME, T0 - 30_000), null, T0)).toBe(true);
  });
  it('a reading without numbers is never sent', () => {
    expect(shouldSend(null, fix({ lat: NaN, lng: -73 }), null, T0)).toBe(false);
  });
  it('the phone clock going back sends again', () => {
    expect(shouldSend(sent(HOME, T0), fix(HOME, T0 - 5_000), null, T0 - 5_000)).toBe(true);
  });
});

describe('the job a position belongs to', () => {
  const jobs = [
    { id: 'a', status: 'done' as const, truck_id: 't1', day: '2026-11-04' },
    { id: 'b', status: 'on_site' as const, truck_id: 't1', day: '2026-11-04' },
    { id: 'c', status: 'en_route' as const, truck_id: 't1', day: '2026-11-04' },
    { id: 'd', status: 'en_route' as const, truck_id: 't2', day: '2026-11-04' },
    { id: 'e', status: 'en_route' as const, truck_id: 't1', day: '2026-11-03' }
  ];
  it('the job driven to first, then the job worked at, only today and on my trucks', () => {
    expect(currentJobId(jobs, ['t1'], '2026-11-04')).toBe('c');
    expect(currentJobId(jobs.filter((j) => j.id !== 'c'), ['t1'], '2026-11-04')).toBe('b');
    expect(currentJobId(jobs, ['t9'], '2026-11-04')).toBeNull();
    expect(currentJobId(jobs, [], '2026-11-04')).toBeNull();
    expect(currentJobId(jobs, ['t1'], '2026-11-05')).toBeNull();
  });
});

describe('« il y a … »', () => {
  it('says it in words', () => {
    lang.value = 'fr';
    expect(agoText(T0 - 20_000, T0)).toBe('à l’instant');
    expect(agoText(T0 - 60_000, T0)).toBe('il y a 1 min');
    expect(agoText(T0 - 59 * 60_000, T0)).toBe('il y a 59 min');
    expect(agoText(T0 - 65 * 60_000, T0)).toBe('il y a 1 h 05');
    expect(agoText(new Date(T0 - 3 * 60_000).toISOString(), T0)).toBe('il y a 3 min');
    expect(agoText(null, T0)).toBe('à l’instant');
  });
  it('and in English', () => {
    lang.value = 'en';
    expect(agoText(T0 - 3 * 60_000, T0)).toBe('3 min ago');
    expect(agoText(T0 - 125 * 60_000, T0)).toBe('2 h 5 min ago');
    lang.value = 'fr';
  });
});
