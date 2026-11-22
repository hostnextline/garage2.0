import { describe, it, expect } from 'vitest';
import { mondayOf, weekOf, monthOf, minutesOf, toCheck, weekHours, periodMinutes, teamWeek, decimalHours, weekLabel, isoAt, planDraft, dayOfIso } from './logic';

// every moment is built on the garage's clock (isoAt: lib/dates instantOf), so the tests give the same answers in any zone
let n = 0;
const shift = (staff: string, day: string, from: number, to: number | null, extra: Record<string, unknown> = {}) => ({
  id: `s${++n}`, staff_id: staff, started_at: isoAt(day, from), ended_at: to == null ? null : (to < from ? isoAt(nextDay(day), to) : isoAt(day, to)),
  deleted_at: null, fixed_at: null, fixed_by: null, ...extra
});
const nextDay = (d: string) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m - 1, dd + 1, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const H = (h: number, m = 0) => h * 60 + m;

describe('« Heures travaillées »: the week goes from Monday to Sunday', () => {
  it('finds the Monday of any day (a Sunday belongs to the week that began 6 days before)', () => {
    expect(mondayOf('2026-11-19')).toBe('2026-11-16');   // Thursday
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');   // Monday
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');   // Sunday
    expect(mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(weekOf('2026-11-19')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  });
  it('crosses the months and the years', () => {
    expect(weekOf('2026-12-31')[0]).toBe('2026-12-28');
    expect(weekOf('2026-12-31')[6]).toBe('2027-01-03');
    expect(monthOf('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthOf('2026-11-19')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('says the week in a few words', () => {
    expect(weekLabel('2026-11-16', 'fr')).toBe('16 – 22 nov. 2026');
    expect(weekLabel('2026-11-30', 'fr')).toBe('30 nov. – 6 déc. 2026');
    expect(weekLabel('2026-12-28', 'fr')).toBe('28 déc. 2026 – 3 janv. 2027');
    expect(weekLabel('2026-11-16', 'en')).toBe('Nov 16 – 22, 2026');
    expect(weekLabel('2026-11-30', 'en')).toBe('Nov 30 – Dec 6, 2026');
  });
  it('writes the hours with decimals, for the pay', () => {
    expect(decimalHours(H(23, 45), 'fr')).toBe('23,75 h');
    expect(decimalHours(H(8, 8), 'en')).toBe('8.13 h');
    expect(decimalHours(0, 'fr')).toBe('0,00 h');
  });
});

describe('« Heures travaillées »: the days and the totals', () => {
  const now = Date.parse(isoAt('2026-11-19', H(15)));
  const all = [
    shift('m', '2026-11-16', H(8, 4), H(16, 12)),            // 8 h 08
    shift('m', '2026-11-17', H(8), H(12)),                    // 4 h, then back after lunch
    shift('m', '2026-11-17', H(13), H(17, 30)),               // 4 h 30
    shift('m', '2026-11-18', H(22), H(2)),                    // over midnight: counts on the day it began (4 h)
    shift('m', '2026-11-19', H(8), null),                     // open: until now (7 h)
    shift('m', '2026-11-15', H(9), H(17)),                    // Sunday before: another week
    shift('m', '2026-11-20', H(9), H(10), { deleted_at: '2026-11-19T00:00:00Z' }), // removed
    shift('o', '2026-11-16', H(9), H(10))                     // someone else
  ];
  it('puts each day of work on the day it began, an open one counted until now', () => {
    const w = weekHours(all, 'm', '2026-11-19', now);
    expect(w.monday).toBe('2026-11-16');
    expect(w.days.map((d) => d.minutes)).toEqual([H(8, 8), H(8, 30), H(4), H(7), 0, 0, 0]);
    expect(w.days[1].shifts).toHaveLength(2);
    expect(w.minutes).toBe(H(27, 38));
    expect(w.daysWorked).toBe(4);
    expect(w.open).toBe(true);
    expect(w.days[3].open).toBe(true);
    expect(w.check).toBe(0);
  });
  it('never counts a removed day or someone else’s', () => {
    const w = weekHours(all, 'o', '2026-11-19', now);
    expect(w.minutes).toBe(H(1));
    expect(weekHours(all, 'm', '2026-11-19', now).days[4].shifts).toHaveLength(0);
  });
  it('adds up a month', () => {
    expect(periodMinutes(all, 'm', '2026-11-01', '2026-11-30', now)).toBe(H(27, 38) + H(8));
    expect(periodMinutes(all, 'm', '2026-11-16', '2026-11-16', now)).toBe(H(8, 8));
  });
  it('an open day counts the minutes up to now', () => {
    const s = shift('m', '2026-11-19', H(14), null);
    expect(minutesOf(s, now)).toBe(60);
    expect(dayOfIso(s.started_at)).toBe('2026-11-19');
  });
});

describe('« Heures travaillées »: the days to check', () => {
  it('a day closed by the night (16 hours or more) is to check, until someone corrects it', () => {
    const forgot = shift('m', '2026-11-17', H(8, 4), H(3, 17));   // closed at 3 h 17 the next night: 19 h 13
    expect(minutesOf(forgot)).toBe(H(19, 13));
    expect(toCheck(forgot)).toBe(true);
    expect(toCheck({ ...forgot, fixed_at: '2026-11-18T14:00:00Z' })).toBe(false);
    expect(toCheck(shift('m', '2026-11-17', H(6), H(21, 59)))).toBe(false);  // 15 h 59: a long day, not forgotten
    expect(toCheck(shift('m', '2026-11-17', H(8), null))).toBe(false);       // still open: nothing to correct yet
    const w = weekHours([forgot], 'm', '2026-11-17');
    expect(w.check).toBe(1);
    expect(w.days[1].check).toBe(true);
  });
});

describe('« Heures travaillées »: the list of the team', () => {
  const people = [
    { id: 'z', full_name: 'Zack Mécano', short_name: null, roles: ['mechanic'] as const, active: true, deleted_at: null },
    { id: 'a', full_name: 'Ali Mécano', short_name: null, roles: ['mechanic'] as const, active: true, deleted_at: null },
    { id: 'o', full_name: 'Omar Proprio', short_name: null, roles: ['owner'] as const, active: true, deleted_at: null },
    { id: 't', full_name: 'Tina Trésorière', short_name: null, roles: ['treasurer', 'owner'] as const, active: true, deleted_at: null },
    { id: 'x', full_name: 'Xavier Parti', short_name: null, roles: ['mechanic'] as const, active: true, deleted_at: '2026-11-01T00:00:00Z' }
  ].map((p) => ({ ...p, roles: [...p.roles] }));
  it('shows every mechanic, and the others only when they worked that week', () => {
    const rows = teamWeek([shift('o', '2026-11-18', H(9), H(12)), shift('t', '2026-11-09', H(9), H(12))], people, '2026-11-19');
    expect(rows.map((r) => r.staff.id)).toEqual(['a', 'o', 'z']);
    expect(rows.find((r) => r.staff.id === 'o')!.week.minutes).toBe(H(3));
    expect(rows.find((r) => r.staff.id === 'a')!.week.minutes).toBe(0);
  });
});

describe('« Heures travaillées »: the correction sheet follows the server’s rules', () => {
  const now = Date.parse(isoAt('2026-11-19', H(15)));
  const others = [shift('m', '2026-11-17', H(8), H(12)), shift('m', '2026-11-17', H(13), H(17))];
  it('a correct day: its moments and its minutes; an end before the start is the next morning', () => {
    const r = planDraft({ day: '2026-11-18', start: H(8, 4), end: H(16, 12) }, { open: false, others, now });
    expect(r.error).toBeUndefined();
    expect(r.plan).toEqual({ startIso: isoAt('2026-11-18', H(8, 4)), endIso: isoAt('2026-11-18', H(16, 12)), minutes: H(8, 8), nextDay: false });
    const late = planDraft({ day: '2026-11-17', start: H(20), end: H(1, 30) }, { open: false, others, now });
    expect(late.plan).toMatchObject({ endIso: isoAt('2026-11-18', H(1, 30)), minutes: H(5, 30), nextDay: true });
  });
  it('asks for both times (an open day keeps no end)', () => {
    expect(planDraft({ day: '2026-11-18', start: null, end: H(16) }, { open: false, others, now }).error).toBe('no_start');
    expect(planDraft({ day: '2026-11-18', start: H(8), end: null }, { open: false, others, now }).error).toBe('no_end');
    const open = planDraft({ day: '2026-11-19', start: H(7, 30), end: null }, { open: true, others, now });
    expect(open.plan).toMatchObject({ endIso: null, minutes: H(7, 30) });
  });
  it('refuses the same start and end, a time not yet passed, more than 24 hours', () => {
    expect(planDraft({ day: '2026-11-18', start: H(8), end: H(8) }, { open: false, others, now }).error).toBe('zero');
    expect(planDraft({ day: '2026-11-19', start: H(8), end: H(16) }, { open: false, others, now }).error).toBe('future');
    expect(planDraft({ day: '2026-11-20', start: H(8), end: H(9) }, { open: false, others, now }).error).toBe('future');
    expect(planDraft({ day: '2026-11-19', start: H(8), end: H(15, 4) }, { open: false, others, now }).error).toBeUndefined(); // 5 minutes of grace
  });
  it('refuses hours over another day of the same person, but not over the day being corrected', () => {
    expect(planDraft({ day: '2026-11-17', start: H(11), end: H(14) }, { open: false, others, now }).error).toBe('overlap');
    expect(planDraft({ day: '2026-11-17', start: H(12), end: H(13) }, { open: false, others, now }).error).toBeUndefined();  // the lunch hour, end to end
    expect(planDraft({ day: '2026-11-17', start: H(7), end: H(12, 30) }, { open: false, others, now, selfId: others[0].id }).error).toBeUndefined();
    expect(planDraft({ day: '2026-11-17', start: H(16), end: null }, { open: true, others, now }).error).toBe('overlap');
  });
});
