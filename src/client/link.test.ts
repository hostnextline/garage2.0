/* What the customer's phone remembers between the pages (each case failed on the old logic). */
import { describe, it, expect, beforeEach } from 'vitest';
import { appointmentOfTrip, forgetAppointment, forgetPaying, recallPaying, rememberAppointment, rememberPaying } from './link';
import { localDayOf, relDay, montrealToday } from './format';
import { translate } from './i18n';

const NOW = Date.parse('2026-11-17T15:30:00Z');          // 10:30 in Montréal
const TODAY = localDayOf(NOW)!;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('« Voir mon rendez-vous » on the tracking page (client-page-11)', () => {
  it('offers today’s appointment, opened on this phone', () => {
    rememberAppointment('APPT-today-token', TODAY, NOW - 3600000);
    expect(appointmentOfTrip('TRIP-token', NOW)).toBe('APPT-today-token');
  });
  it('never offers last month’s invoice link: it is not the appointment the truck drives to', () => {
    rememberAppointment('APPT-old-token', '2026-10-20', NOW - 20 * 86400000);
    expect(appointmentOfTrip('TRIP-token', NOW)).toBeNull();
  });
  it('an entry written by the old page (no day) only counts when the tracking link is that very appointment link', () => {
    localStorage.setItem('his.client.t', JSON.stringify({ token: 'APPT-token', at: NOW - 1000 }));
    expect(appointmentOfTrip('TRIP-token', NOW)).toBeNull();
    expect(appointmentOfTrip('APPT-token', NOW)).toBe('APPT-token');
  });
  it('forgets a link the server refused (x-deadcode-25), and only that one', () => {
    rememberAppointment('APPT-today-token', TODAY, NOW);
    forgetAppointment('another-token');
    expect(appointmentOfTrip('TRIP-token', NOW)).toBe('APPT-today-token');
    forgetAppointment('APPT-today-token');
    expect(appointmentOfTrip('TRIP-token', NOW)).toBeNull();
  });
  it('keeps the same storage key the old page read', () => {
    rememberAppointment('APPT-today-token', TODAY, NOW);
    expect(JSON.parse(localStorage.getItem('his.client.t')!)).toMatchObject({ token: 'APPT-today-token', at: NOW });
  });
});

describe('a card payment on its way (client-page-07)', () => {
  it('remembers, for this tab and this link only, what was received before Stripe', () => {
    rememberPaying('tok-1', 5000, NOW);
    expect(recallPaying('tok-1', NOW + 60000)).toBe(5000);
    expect(recallPaying('tok-2', NOW + 60000)).toBeNull();
    expect(recallPaying('tok-1', NOW + 3 * 3600000)).toBeNull();   // another visit
    forgetPaying();
    expect(recallPaying('tok-1', NOW)).toBeNull();
  });
});

describe('Montréal’s calendar (client-page-25)', () => {
  it('« Aujourd’hui » follows the garage’s day, whatever the phone’s time zone', () => {
    // 2026-11-18 03:30 UTC = 2026-11-17 22:30 in Montréal: still the 17th at the garage
    const late = new Date('2026-11-18T03:30:00Z');
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';          // a relative booking from abroad: the phone already says the 18th
    try {
      expect(montrealToday(late)).toBe('2026-11-17');
      expect(relDay('2026-11-17', late)).toBe('today');
      expect(relDay('2026-11-18', late)).toBe('tomorrow');
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });
});

describe('the dictionary lookup (i18n-09)', () => {
  it('never answers a function of every object for a key like « constructor »', () => {
    const d = { fr: { a: 'oui' }, en: { a: 'yes' } };
    expect(translate(d, 'fr', 'constructor')).toBe('constructor');
  });
});
