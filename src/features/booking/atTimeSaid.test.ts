/* « Réserver à l'heure choisie » (Part 30): what is said once a full time was booked anyway at that minute. */
import { describe, it, expect, beforeEach } from 'vitest';
import { lang } from '../../lib/i18n';
import { upsertLocal, clearAll } from '../../data/store';
import { bookAtAnswer } from '../../data/bookAt';
import { atTimeSaid } from './atTimeSaid';

const DAY = '2026-11-26';
const stop = (id: string, late: boolean, delay: number) => ({ id, day: DAY, truck_id: 'T1', order_before: 1, order_after: 2, eta_before: 700, eta_after: 700 + delay,
  win_start: 540, win_end: 780, delay_min: delay, late, late_min: late ? 700 + delay - 780 : 0, measured: null });
const booked = (o: { late?: string[]; pushed?: string[]; forced?: boolean; stops?: ReturnType<typeof stop>[] }) => ({
  kind: 'booked' as const, at: 840, id: 'N', data: {}, late: o.late ?? [], pushed: o.pushed ?? [], forced: !!o.forced,
  answer: bookAtAnswer({ ok: true, exact: true, at: 840, job_id: 'N', truck_id: 'T1', win_start: 780, win_end: 1020, forced: !!o.forced, stops: o.stops ?? [], over_hours: 0 })
});

beforeEach(() => {
  lang.value = 'fr';
  clearAll();
  upsertLocal('customers', [{ id: 'c-d', first_name: 'Denis', last_name: 'R' }, { id: 'c-e', first_name: 'Emma', last_name: 'L' }], { force: true });
  upsertLocal('jobs', [{ id: 'D', customer_id: 'c-d', day: DAY, block: 'day', status: 'booked' }, { id: 'E', customer_id: 'c-e', day: DAY, block: 'day', status: 'booked' }], { force: true });
});

describe('the words once booked at a minute', () => {
  it('room at that minute, nobody late: « Réservé : jeudi 26 novembre à 14 h. »; the text’s window is the one of 14 h', () => {
    const s = atTimeSaid(booked({ pushed: ['E'] }), DAY, 'fr');
    expect(s.text).toBe('Réservé : jeudi 26 novembre à 14 h.');
    expect(s.kind).toBe('ok');
    expect(s.when).toContain('entre 13 h et 17 h');
  });
  it('forced: « Réservé quand même », the late ones named to tell (the app texts them nothing)', () => {
    const s = atTimeSaid(booked({ forced: true, late: ['D'], stops: [stop('D', true, 130)] }), DAY, 'fr');
    expect(s.text).toBe('Réservé quand même : jeudi 26 novembre à 14 h. Avertis Denis : servi après sa plage.');
    expect(s.kind).toBe('info');
    // his new window leaves with the day's button (Part 28)
    const g = atTimeSaid(booked({ forced: true, late: ['D'], stops: [stop('D', true, 130)] }), DAY, 'fr', () => [780, 1020]);
    expect(g.text).toContain('Denis aura une nouvelle plage : elle part avec « Envoyer les heures aux clients ».');
  });
  it('in English', () => {
    lang.value = 'en';
    const s = atTimeSaid(booked({ forced: true, late: ['D'], stops: [stop('D', true, 130)] }), DAY, 'en').text;
    expect(s).toBe('Booked anyway: Thursday, November 26 at 2 p.m. Tell Denis: reached after their window.');
  });
});
