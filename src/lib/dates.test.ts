import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { addDays, addMonths, weekStart, weekDays, dow, clock, clockRange, duration, parseHm, hm, isValidDay, mergeRanges, overlapMinutes,
  cellsToRanges, rangesToCells, daysBetween, longDay, shortDate, tinyDay, monthName, parseDay, dayOf, minuteOf, today, nowMinute, stamp,
  windowFor } from './dates';

describe('days', () => {
  it('adds days across months and the DST change (Nov 1 2026)', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('the week starts on Sunday', () => {
    expect(dow('2026-11-04')).toBe(3);
    expect(weekStart('2026-11-04')).toBe('2026-11-01');
    expect(weekDays('2026-11-04')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
    expect(weekStart('2026-11-01')).toBe('2026-11-01');
  });
  it('validates days', () => {
    expect(isValidDay('2026-02-29')).toBe(false);
    expect(isValidDay('2028-02-29')).toBe(true);
    expect(isValidDay('2026-13-01')).toBe(false);
    expect(isValidDay('2026-1-05')).toBe(false);
    expect(isValidDay(20261105)).toBe(false);
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7);
  });
  it('the same day n months later, clamped to the end of a short month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 6)).toBe('2027-05-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });
  it('writes days in French and English', () => {
    const now = new Date(2026, 10, 4);
    expect(longDay('2026-11-04', 'fr', now)).toBe('mercredi 4 novembre');
    expect(longDay('2026-11-04', 'en', now)).toBe('Wednesday, November 4');
    expect(longDay('2027-01-04', 'fr', now)).toContain('2027');
    expect(shortDate('2026-11-04', 'fr')).toBe('4 nov. 2026');
    expect(shortDate('2026-11-04', 'en')).toBe('Nov 4, 2026');
    expect(tinyDay('2026-11-04', 'fr')).toBe('mer. 4');
    expect(monthName('2026-11-04', 'fr')).toBe('novembre 2026');
  });
  it('a day that is not a date shows nothing instead of throwing (a hand-typed #/agenda/abc)', () => {
    expect(longDay('abc')).toBe('');
    expect(shortDate('abc')).toBe('');
    expect(tinyDay('')).toBe('');
    expect(monthName('2026-xx-01')).toBe('');
  });
  it('parseDay stays the device-local noon (screens read it with getDate())', () => {
    const d = parseDay('2026-11-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 4, 12]);
  });
});

describe('clock', () => {
  it('Québec French', () => {
    expect(clock(8 * 60)).toBe('8 h');
    expect(clock(13 * 60 + 30)).toBe('13 h 30');
    expect(clockRange(480, 720)).toBe('8 h à 12 h');
  });
  it('English', () => {
    expect(clock(8 * 60, 'en')).toBe('8 a.m.');
    expect(clock(12 * 60, 'en')).toBe('12 p.m.');
    expect(clock(13 * 60 + 5, 'en')).toBe('1:05 p.m.');
  });
  it('durations', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(90)).toBe('1 h 30');
    expect(duration(120)).toBe('2 h');
    expect(duration(90, 'en')).toBe('1 h 30 min');
    expect(duration(0)).toBe('0 min');
  });
  it('reads times', () => {
    expect(parseHm('8')).toBe(480);
    expect(parseHm('8:30')).toBe(510);
    expect(parseHm('8h30')).toBe(510);
    expect(parseHm('13 h 30')).toBe(810);
    expect(parseHm('25')).toBeNull();
    expect(parseHm('24:00')).toBe(1440);
    expect(hm(510)).toBe('08:30');
    expect(hm(1440)).toBe('24:00');
  });
  // core-data-32: computed minutes are not always whole, and a « time left » can be negative
  it('rounds to the minute before writing: never « 1 h 60 » or « 10 h 12.5 »', () => {
    expect(duration(119.6)).toBe('2 h');
    expect(duration(59.6)).toBe('1 h');
    expect(duration(89.4)).toBe('1 h 29');
    expect(duration(119.6, 'en')).toBe('2 h');
    expect(clock(612.5)).toBe('10 h 13');
    expect(clock(612.4, 'en')).toBe('10:12 a.m.');
    expect(hm(510.4)).toBe('08:30');
  });
  it('a negative duration carries its sign once', () => {
    expect(duration(-30)).toBe('-30 min');
    expect(duration(-90)).toBe('-1 h 30');
    expect(duration(-90, 'en')).toBe('-1 h 30 min');
  });
  it('the dial goes round past midnight, both ways', () => {
    expect(clock(1440)).toBe('0 h');
    expect(clock(1500)).toBe('1 h');
    expect(clock(-30)).toBe('23 h 30');
    expect(clock(1440, 'en')).toBe('12 a.m.');
  });
});

describe('blocks and ranges', () => {
  it('cuts the arrival window like the server (win_for)', () => {
    expect(windowFor(15 * 60)).toEqual([14 * 60, 18 * 60]);
    expect(windowFor(8 * 60)).toEqual([8 * 60, 12 * 60]);
    expect(windowFor(19 * 60 + 40)).toEqual([16 * 60, 20 * 60]);
  });
  it('merges and measures ranges', () => {
    expect(mergeRanges([[600, 720], [480, 600], [800, 900]])).toEqual([[480, 720], [800, 900]]);
    expect(overlapMinutes([[480, 960]], 480, 720)).toBe(240);
    expect(overlapMinutes([[540, 660]], 480, 720)).toBe(120);
    expect(overlapMinutes([[700, 800]], 480, 720)).toBe(20);
  });
  it('turns selected cells into hours and back', () => {
    const r = cellsToRanges([480, 510, 540, 600], 30);
    expect(r).toEqual([[480, 570], [600, 630]]);
    expect(rangesToCells(r, 30, 420, 720)).toEqual([480, 510, 540, 600]);
  });
});

/* core-data-18 / x-time-01: the garage runs on Montréal's clock (America/Toronto), whatever zone the phone is set to.
   Instants are written with their UTC offset, never new Date(y, m, d, h), so the cases mean the same in every zone. */
const at = (iso: string) => new Date(iso);
const ZONES = ['America/Toronto', 'Europe/Paris', 'America/Vancouver', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];

for (const zone of ZONES) {
  describe(`the garage's clock on a phone set to ${zone}`, () => {
    const before = process.env.TZ;
    beforeAll(() => { process.env.TZ = zone; });
    afterAll(() => { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; });

    it('the zone really is the phone\'s', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    });
    it('23 h 30 and 0 h 30 in Montréal, an ordinary night (Sat 14 → Sun 15 Nov 2026, UTC−5)', () => {
      expect(today(at('2026-11-15T04:30:00Z'))).toBe('2026-11-14');
      expect(nowMinute(at('2026-11-15T04:30:00Z'))).toBe(23 * 60 + 30);
      expect(today(at('2026-11-15T05:30:00Z'))).toBe('2026-11-15');
      expect(nowMinute(at('2026-11-15T05:30:00Z'))).toBe(30);
    });
    it('19 h 30 Sunday in Montréal is still Sunday (it is already Monday in Paris)', () => {
      expect(today(at('2026-11-16T00:30:00Z'))).toBe('2026-11-15');
      expect(nowMinute(at('2026-11-16T00:30:00Z'))).toBe(19 * 60 + 30);
      expect(stamp('2026-11-16T00:30:00Z')).toBe('15 nov. 2026, 19 h 30');
      expect(stamp('2026-11-16T00:30:00Z', 'en')).toBe('Nov 15, 2026, 7:30 p.m.');
    });
    it('the spring night (Sun 8 March 2026: 2 h becomes 3 h)', () => {
      expect(today(at('2026-03-08T05:30:00Z'))).toBe('2026-03-08');
      expect(nowMinute(at('2026-03-08T05:30:00Z'))).toBe(30);        // 0 h 30 EST
      expect(nowMinute(at('2026-03-08T06:59:00Z'))).toBe(60 + 59);   // 1 h 59 EST
      expect(nowMinute(at('2026-03-08T07:00:00Z'))).toBe(3 * 60);    // 3 h EDT
      expect(today(at('2026-03-09T03:30:00Z'))).toBe('2026-03-08');  // 23 h 30 EDT
      expect(nowMinute(at('2026-03-09T03:30:00Z'))).toBe(23 * 60 + 30);
      expect(today(at('2026-03-09T04:30:00Z'))).toBe('2026-03-09');  // 0 h 30 EDT
    });
    it('the autumn night (Sun 1 Nov 2026: 2 h goes back to 1 h)', () => {
      expect(today(at('2026-11-01T04:30:00Z'))).toBe('2026-11-01');  // 0 h 30 EDT
      expect(nowMinute(at('2026-11-01T04:30:00Z'))).toBe(30);
      expect(nowMinute(at('2026-11-01T05:30:00Z'))).toBe(90);        // 1 h 30 EDT
      expect(nowMinute(at('2026-11-01T06:30:00Z'))).toBe(90);        // 1 h 30 EST, the second time
      expect(today(at('2026-11-02T04:30:00Z'))).toBe('2026-11-01');  // 23 h 30 EST
      expect(today(at('2026-11-02T05:30:00Z'))).toBe('2026-11-02');  // 0 h 30 EST
    });
    it('an instant from the server becomes its Montréal day and minute', () => {
      expect(dayOf(at('2026-12-01T01:00:00Z'))).toBe('2026-11-30');   // a payment of 30 Nov at 20 h stays in November
      expect(minuteOf(at('2026-12-01T01:00:00Z'))).toBe(20 * 60);
      expect(dayOf(at('2026-07-01T03:59:00Z'))).toBe('2026-06-30');   // summer: UTC−4
      expect(minuteOf(at('2026-07-01T04:00:00Z'))).toBe(0);
    });
    it('a time that is not a date gives nothing', () => {
      expect(dayOf(new Date('nope'))).toBe('');
      expect(minuteOf(new Date('nope'))).toBeNaN();
      expect(stamp('nope')).toBe('');
      expect(stamp(null)).toBe('');
    });
    it('calendar maths do not move with the phone\'s zone', () => {
      expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
      expect(addDays('2026-11-15', 30)).toBe('2026-12-15');
      expect(dow('2026-03-08')).toBe(0);
      expect(dow('2026-11-01')).toBe(0);
      expect(weekStart('2026-11-07')).toBe('2026-11-01');
      expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
      expect(daysBetween('2026-10-25', '2026-11-08')).toBe(14);
      expect(isValidDay('2026-03-08')).toBe(true);
      expect(addMonths('2026-10-31', 1)).toBe('2026-11-30');
    });
    it('days are written the same on every phone', () => {
      const now = at('2026-11-16T00:30:00Z');
      expect(longDay('2026-03-08', 'fr', now)).toBe('dimanche 8 mars');
      expect(longDay('2026-11-01', 'en', now)).toBe('Sunday, November 1');
      expect(shortDate('2026-11-01', 'fr')).toBe('1 nov. 2026');
      expect(tinyDay('2026-03-08', 'en')).toBe('Sun 8');
    });
    it('« this year » is Montréal\'s year on New Year\'s Eve evening', () => {
      // 31 Dec 2026, 20 h in Montréal: already 2027 in Paris and Tokyo, the year is not written
      const now = at('2027-01-01T01:00:00Z');
      expect(longDay('2026-12-31', 'fr', now)).toBe('jeudi 31 décembre');
      expect(longDay('2027-01-02', 'fr', now)).toBe('samedi 2 janvier 2027');
    });
  });
}

/* review lt-6: the Montréal day and minute are remembered per minute of time (Intl is slow); the answers must not move */
describe('the garage clock remembers its answers', () => {
  it('every second of a minute gets that minute, the next minute gets the next one', () => {
    expect(minuteOf(at('2026-11-15T04:30:00.000Z'))).toBe(23 * 60 + 30);
    expect(minuteOf(at('2026-11-15T04:30:59.999Z'))).toBe(23 * 60 + 30);
    expect(dayOf(at('2026-11-15T04:30:59.999Z'))).toBe('2026-11-14');
    expect(minuteOf(at('2026-11-15T04:31:00.000Z'))).toBe(23 * 60 + 31);
    expect(minuteOf(at('2026-11-15T04:59:59.999Z'))).toBe(23 * 60 + 59);
    expect(dayOf(at('2026-11-15T05:00:00.000Z'))).toBe('2026-11-15');
    expect(minuteOf(at('2026-11-15T05:00:00.000Z'))).toBe(0);
  });
  it('before 1970 too (a negative time)', () => {
    expect(dayOf(at('1969-12-31T23:59:30Z'))).toBe('1969-12-31');
    expect(minuteOf(at('1969-12-31T23:59:30Z'))).toBe(18 * 60 + 59);
  });
  it('the same answer asked again, and after the memory is emptied', () => {
    const first = stamp('2026-11-16T00:30:00Z');
    for (let i = 0; i < 6000; i++) minuteOf(new Date(Date.UTC(2026, 0, 1) + i * 60000)); // fills and empties it
    expect(stamp('2026-11-16T00:30:00Z')).toBe(first);
    expect(minuteOf(new Date(Date.UTC(2026, 0, 1) + 5999 * 60000))).toBe((5999 + 19 * 60) % 1440); // 1 Jan 2026 0 h UTC = 19 h EST
    expect(today(at('2026-11-15T04:30:00Z'))).toBe('2026-11-14');
  });
  /* review fluidite-02: the memory used to be emptied at 5,000 minutes, so a screen going over more payments than that
     (a year or two of a busy garage) asked Intl again for every one at every redraw (about 12 times slower) */
  it('a second pass over 8,000 different moments does not ask Intl again', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    try {
      // 8,000 payments, one every 97 minutes: about a year and a half of distinct minutes, hours and days
      const moments = Array.from({ length: 8000 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 97 * 60000 + 13000));
      const first = moments.map((d) => `${dayOf(d)} ${minuteOf(d)}`);
      spy.mockClear();
      const second = moments.map((d) => `${dayOf(d)} ${minuteOf(d)}`);
      expect(spy).not.toHaveBeenCalled();
      expect(second).toEqual(first);
    } finally { spy.mockRestore(); }
  });
  it('the answers kept are the same as Intl\'s, minute by minute, across both nights the clock changes', () => {
    const ask = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const truth = (d: Date) => {
      const p: Record<string, string> = {};
      for (const x of ask.formatToParts(d)) p[x.type] = x.value;
      return `${p.year}-${p.month}-${p.day} ${(Number(p.hour) % 24) * 60 + Number(p.minute)}`;
    };
    for (const night of ['2026-03-08T00:00:00Z', '2026-11-01T00:00:00Z', '2027-03-14T00:00:00Z', '2027-11-07T00:00:00Z']) {
      const t0 = Date.parse(night);
      for (let m = 0; m < 24 * 60; m += 7) {
        const d = new Date(t0 + m * 60000 + 59000);
        expect(`${dayOf(d)} ${minuteOf(d)}`).toBe(truth(d));
      }
    }
  });
});
