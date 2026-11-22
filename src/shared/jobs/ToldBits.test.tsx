/* What the team reads of a customer without his new hours (Part 28, REARRANGE.md §3.2, §3.6, §3.7, U7): the move's
   toast when the told day is today (or tomorrow after the evening lock), the job screen's line, « Ma journée »'s
   warning. The send list is pretended (openTell). Real store rows; Montréal's clock fixed. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const opened = vi.hoisted(() => [] as string[]);
vi.mock('./TellHost', () => ({ openTell: (day: string) => { opened.push(day); } }));
import { toldDayToast, ToldJobLine, ToldWarn } from './ToldBits';
import { replaceLocal, upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';
import type { Access, Job } from '../../data/types';

const TODAY = '2026-11-23', TOMORROW = '2026-11-24', MONDAY = '2026-11-30';
const owner = { id: 'u1', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'u3', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1'] } as unknown as Access;
/** Denis, told Thursday… here today, 12 h à 16 h (the afternoon) */
const DENIS = { id: 'j1', number: 7, customer_id: 'c1', truck_id: 't1', day: TODAY, block: 'pm', status: 'booked', stop_order: 1, duration_min: 60, deleted_at: null,
  told_day: TODAY, told_start: 720, told_end: 960, told_at: '2026-11-20T10:00:00-05:00', told_how: 'sms' } as unknown as Job;
const at = (iso: string) => { vi.setSystemTime(new Date(iso)); };
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const draw = async (el: preact.ComponentChild) => { await act(async () => { render(el, box); }); };
/** the job's row on the phone after the move */
const after = (patch: Partial<Job>) => upsertLocal('jobs', [{ ...DENIS, ...patch, updated_at: new Date().toISOString() } as never], { force: true });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-11-23T08:00:00-05:00');
  lang.value = 'fr'; opened.length = 0; toasts.value = []; clearAll(); access.value = owner;
  replaceLocal('customers', [{ id: 'c1', first_name: 'Denis', last_name: 'Roy', phone: '514 555-0101', sms_ok: true }] as never);
  replaceLocal('jobs', [DENIS] as never);
});
afterEach(() => { render(null, box); vi.useRealTimers(); access.value = null; });

describe('toldDayToast(before)', () => {
  it('moved out of TODAY, the day he was told: the toast with that day’s button', () => {
    after({ day: MONDAY });
    toldDayToast(DENIS);
    expect(toasts.value.length).toBe(1);
    const x = toasts.value[0];
    expect(x.text).toBe('Denis attendait aujourd’hui : sa nouvelle heure n’est pas partie.');
    expect(x.ms).toBe(10000);
    expect(x.action!.label).toBe('Envoyer les heures aux clients (1)');
    void x.action!.run();
    expect(opened).toEqual([TODAY]);
  });
  it('told TOMORROW: only once the evening lock is past (18 h); a day after tomorrow: never', () => {
    const toldTomorrow = { ...DENIS, day: TOMORROW, told_day: TOMORROW } as Job;
    replaceLocal('jobs', [toldTomorrow] as never);
    upsertLocal('jobs', [{ ...toldTomorrow, block: 'am', updated_at: new Date().toISOString() } as never], { force: true });
    toldDayToast(toldTomorrow);
    expect(toasts.value.length).toBe(0);
    at('2026-11-23T18:05:00-05:00');
    toldDayToast(toldTomorrow);
    expect(toasts.value.map((x) => x.text)).toEqual(['Denis attendait demain : sa nouvelle heure n’est pas partie.']);
    toasts.value = [];
    const later = { ...DENIS, day: '2026-11-26', told_day: '2026-11-26' } as Job;
    replaceLocal('jobs', [{ ...later, day: MONDAY }] as never);
    toldDayToast(later);
    expect(toasts.value.length).toBe(0);
  });
  it('nothing when the move changed nothing he was told, when he has his hours, or for a mechanic', () => {
    toldDayToast(DENIS);                                  // the same row: no change
    expect(toasts.value.length).toBe(0);
    // moved to the afternoon of today again (from a morning row): the hours he was told hold → nothing to send
    toldDayToast({ ...DENIS, block: 'am' } as Job);
    expect(toasts.value.length).toBe(0);
    after({ day: MONDAY });
    access.value = mechanic;
    toldDayToast(DENIS);
    expect(toasts.value.length).toBe(0);
  });
  it('never told anything: no toast (he was told no day)', () => {
    const never = { ...DENIS, told_day: null, told_start: null, told_end: null, told_at: null, told_how: null } as unknown as Job;
    replaceLocal('jobs', [{ ...never, day: MONDAY }] as never);
    toldDayToast(never);
    expect(toasts.value.length).toBe(0);
  });
});

describe('ToldJobLine (the job screen) and ToldWarn (« Ma journée »)', () => {
  it('a changed appointment: what he had, and that it goes with the button; nothing once he has it; owner / « Réserver » only', async () => {
    const moved = { ...DENIS, day: MONDAY } as Job;
    await draw(<ToldJobLine job={moved} />);
    expect(q('told-job-line')!.textContent).toBe('Le client n’a pas encore cette heure (il a eu : aujourd’hui, 12 h à 16 h). Elle part avec « Envoyer les heures aux clients ».');
    await draw(<ToldJobLine job={DENIS} />);
    expect(box.innerHTML).toBe('');
    access.value = mechanic;
    await draw(<ToldJobLine job={moved} />);
    expect(box.innerHTML).toBe('');
  });
  it('never told: « Pas encore averti »; « Ma journée » says it to the mechanic before « Je pars »', async () => {
    const never = { ...DENIS, told_day: null, told_start: null, told_end: null, told_at: null } as unknown as Job;
    await draw(<ToldJobLine job={never} />);
    expect(q('told-job-line')!.textContent).toBe('Pas encore averti');
    access.value = mechanic;
    await draw(<ToldWarn job={never} />);
    expect(q('told-warn')!.textContent).toContain('Denis n’a pas encore été averti de son rendez-vous.');
    await draw(<ToldWarn job={{ ...DENIS, block: 'eve' } as Job} />);
    expect(q('told-warn')!.textContent).toContain('Denis n’a pas eu sa nouvelle heure : il attend aujourd’hui, 12 h à 16 h.');
    await draw(<ToldWarn job={DENIS} />);
    expect(box.innerHTML).toBe('');
  });
  it('English', async () => {
    lang.value = 'en';
    await draw(<ToldJobLine job={{ ...DENIS, day: MONDAY } as Job} />);
    expect(q('told-job-line')!.textContent).toBe('The customer doesn’t have this time yet (they were told: today, 12 p.m. to 4 p.m.). It goes with “Send the times to customers”.');
  });
});
