/* Réglages → Réservations, « Plages d’arrivée de 4 heures »: the switch (owner, behind a question), the numbers and their
   live example, « Heures de la journée » instead of the blocks, « Fixer les plages de demain ». (The server is pretended.) */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls: { name: string; args: unknown[] }[] = [];
const asked: { title: string; text?: string }[] = [];
let sayYes = true;
let lockAnswer: Record<string, unknown> = { ok: true, fixed: 2 };
let switchAnswer: Record<string, unknown> = { ok: true, converted: 7 };
const notifyAnswers: Record<string, Record<string, unknown>> = {};
vi.mock('../../../data/api', async (orig) => {
  const real = await orig<typeof import('../../../data/api')>();
  return {
    ...real,
    windowsSwitch: async (on: boolean) => { calls.push({ name: 'windowsSwitch', args: [on] }); return switchAnswer; },
    lockWindows: async (day: string) => { calls.push({ name: 'lockWindows', args: [day] }); return lockAnswer; },
    notify: async (kind: string, id: string) => { calls.push({ name: 'notify', args: [kind, id] }); return notifyAnswers[id] ?? { ok: true, status: 'sent' }; },
    saveSettings: async (part: string, value: unknown) => { calls.push({ name: 'saveSettings', args: [part, value] }); }
  };
});
vi.mock('../../../data/sync', async (orig) => {
  const real = await orig<typeof import('../../../data/sync')>();
  return { ...real, pull: async (t: string) => { calls.push({ name: 'pull', args: [t] }); }, flush: async () => undefined };
});
vi.mock('../../../ui', async (orig) => {
  const real = await orig<typeof import('../../../ui')>();
  return { ...real, ask: async (o: { title: string; text?: string }) => { asked.push(o); return sayYes; } };
});
vi.mock('../../../shared/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../../shared/places/AddressField', () => ({ AddressField: () => null }));
import { BookingSection } from './BookingSection';
import { lastBack } from './WindowsPanel';
import { drafts } from '../SectionFrame';
import { replaceLocal } from '../../../data/store';
import { access } from '../../../data/auth';
import { toasts } from '../../../ui/toast';
import { addDays, today, nowMinute } from '../../../lib/dates';
import { lang } from '../../../lib/i18n';
import type { Access } from '../../../data/types';

const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
const who = (roles: string[]): Access => ({ id: 'u1', full_name: 'Test', short_name: 'Test', email: null, phone: null, roles, owner: roles.includes('owner'), lang: 'fr', prefs: {}, color: null,
  rights: { settings: true }, trucks: [], card_online: false, texts_online: false } as unknown as Access);
function seed(booking: Record<string, unknown>, roles = ['owner']) {
  replaceLocal('settings', [{ id: '1', booking: { blocks: BLOCKS, horizon_days: 120, speed_kmh: 35, detour: 1.3, stop_min: 5, unknown_min: 20, min_block_min: 45, near_km: 5, home: { label: 'Centrale', address: 'x', lat: 45.5, lng: -73.6 }, ...booking } } as never]);
  access.value = who(roles);
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const sp = (s: string | null | undefined) => String(s).replace(/\s/g, ' ');
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await wait(); await wait(); };
const type = async (id: string, v: string) => { const el = q(id)[0] as HTMLInputElement; await act(async () => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const show = async () => { await act(async () => { render(null, box); render(<BookingSection />, box); }); await wait(); };

beforeEach(() => { lastBack.value = null; lang.value = 'fr'; calls.length = 0; asked.length = 0; sayYes = true; drafts.value = {}; toasts.value = []; lockAnswer = { ok: true, fixed: 2 }; switchAnswer = { ok: true, converted: 7 }; replaceLocal('jobs', []); replaceLocal('customers', []); });

describe('Réglages → Réservations : plages d’arrivée', () => {
  it('off: the panel explains, the blocks editor is there, nothing about windows is written when saving', async () => {
    seed({});
    await show();
    expect(q('booking-windows').length).toBe(1);
    expect(q('windows-switch')[0].getAttribute('aria-checked')).toBe('false');
    expect(q('block-am').length).toBe(1);
    expect(q('windows-before').length + q('windows-lock').length + q('windows-day').length + q('windows-example').length).toBe(0);
    await type('booking-horizon_days', '90');
    await click(q('settings-save')[0]);
    const saved = calls.find((c) => c.name === 'saveSettings')!.args[1] as Record<string, unknown>;
    expect(saved.horizon_days).toBe(90);
    expect('win_before_min' in saved || 'win_after_min' in saved || 'win_round_min' in saved || 'windows_on' in saved).toBe(false);
  });
  it('the switch asks first, says what happens, calls the server, then brings the settings and the jobs', async () => {
    seed({});
    await show();
    sayYes = false;
    await click(q('windows-switch')[0]);
    expect(asked.length).toBe(1);
    expect(sp(asked[0].text)).toContain('leur ancien bloc devient leur plage');
    expect(sp(asked[0].text)).toContain('plage de 4 heures');
    expect(sp(asked[0].text)).toContain('revenir aux blocs');
    expect(calls.length).toBe(0);
    sayYes = true;
    await click(q('windows-switch')[0]);
    expect(calls.map((c) => [c.name, c.args[0]])).toEqual([['windowsSwitch', true], ['pull', 'settings'], ['pull', 'jobs']]);
    expect(sp(toasts.value[toasts.value.length - 1].text)).toContain('7 rendez-vous');
  });
  it('« Revenir aux blocs »: the customers told a window outside their block now are listed to call or text, and the days kept (R87)', async () => {
    seed({ windows_on: true });
    const tomorrow = addDays(today(), 1);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'fr' }, { id: 'c2', first_name: 'Karim', last_name: 'Haddad', phone: null, lang: 'en' }] as never);
    replaceLocal('jobs', [{ id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'pm', status: 'booked' }, { id: 'j2', number: 42, customer_id: 'c2', day: tomorrow, block: 'am', status: 'booked' }] as never);
    switchAnswer = { ok: true, converted: 2, on: false,
      to_call: [{ job_id: 'j1', day: tomorrow, block: 'pm', win_start: 600, win_end: 840, customer_id: 'c1' }, { job_id: 'j2', day: tomorrow, block: 'am', win_start: 420, win_end: 660, customer_id: 'c2' }],
      kept: [{ day: tomorrow, block: 'eve' }] };
    await show();
    expect(q('windows-back').length).toBe(0);
    await click(q('windows-switch')[0]);
    expect(calls[0]).toEqual({ name: 'windowsSwitch', args: [false] });
    const list = q('windows-back')[0];
    expect(list).toBeTruthy();
    expect(sp(list.textContent)).toContain('2 clients ont reçu une plage qui n’est plus dans leur bloc');
    const rows = q('windows-back-row');
    expect(rows.length).toBe(2);
    expect(sp(rows[0].textContent)).toContain('Julie Roy');
    expect(sp(rows[0].textContent)).toContain('Plage dite : 10 h à 14 h');
    expect(sp(rows[0].textContent)).toContain('Maintenant : demain après-midi (12 h à 16 h)');
    const links = [...rows[0].querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
    expect(links[0]).toMatch(/^tel:\+?1?5145551234$/);
    expect(decodeURIComponent(links[1])).toContain('arrivera demain après-midi');
    expect(sp(rows[1].textContent)).toContain('Karim Haddad');
    expect(sp(rows[1].textContent)).toContain('Pas de numéro');
    expect(rows[1].querySelectorAll('a').length).toBe(0);
    expect(sp(q('windows-kept')[0].textContent)).toContain('Demain soir');
  });
  it('the list of customers to call stays after leaving Réglages, until « Fermer »; another account on the phone never sees it (settings-team-r2-4)', async () => {
    seed({ windows_on: true });
    const tomorrow = addDays(today(), 1);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'fr' }] as never);
    replaceLocal('jobs', [{ id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'pm', status: 'booked' }] as never);
    switchAnswer = { ok: true, converted: 1, on: false, to_call: [{ job_id: 'j1', day: tomorrow, block: 'pm', win_start: 600, win_end: 840, customer_id: 'c1' }],
      kept: [{ day: tomorrow, block: 'eve' }] };
    await show();
    await click(q('windows-switch')[0]);
    expect(q('windows-back-row').length).toBe(1);
    // the owner leaves Réglages, the server's answer is already in: Réservations opened again shows it again
    seed({ windows_on: false });
    await act(async () => { render(null, box); });
    await show();
    expect(q('windows-back').length).toBe(1);
    expect(sp(q('windows-back-row')[0].textContent)).toContain('Julie Roy');
    expect(q('windows-kept').length).toBe(1);
    // another account signed in on this phone: nothing of it
    access.value = { ...who(['owner']), id: 'u2' } as Access;
    await show();
    expect(q('windows-back').length + q('windows-kept').length).toBe(0);
    access.value = who(['owner']);
    await show();
    expect(q('windows-back').length).toBe(1);
    // « Fermer » takes the list away, also when Réservations opens again; the days kept stay until their own « Fermer »
    await click(q('windows-back-close')[0]);
    expect(q('windows-back').length).toBe(0);
    expect(q('windows-kept').length).toBe(1);
    await show();
    expect(q('windows-back').length).toBe(0);
    await click(q('windows-kept-close')[0]);
    expect(q('windows-kept').length).toBe(0);
    await show();
    expect(q('windows-back').length + q('windows-kept').length).toBe(0);
  });
  it('an older server answers neither list: the screen is the one of before; turning on shows only the days kept', async () => {
    seed({ windows_on: true });
    await show();
    await click(q('windows-switch')[0]);
    expect(q('windows-back').length + q('windows-kept').length).toBe(0);
    seed({});
    switchAnswer = { ok: true, converted: 1, on: true, to_call: [{ job_id: 'x', day: today(), block: 'am' }], kept: [{ day: today(), block: 'am' }] };
    await show();
    await click(q('windows-switch')[0]);
    expect(q('windows-back').length).toBe(0);
    expect(q('windows-kept').length).toBe(1);
  });
  it('someone who is not the owner cannot switch; the office may fix tomorrow’s windows', async () => {
    seed({ windows_on: true }, ['office']);
    await show();
    expect((q('windows-switch')[0] as HTMLButtonElement).disabled).toBe(true);
    await click(q('windows-lock')[0]);
    expect(calls[0]).toEqual({ name: 'lockWindows', args: [addDays(today(), 1)] });
    expect(calls[1]).toEqual({ name: 'pull', args: ['jobs'] });
    expect(sp(toasts.value[toasts.value.length - 1].text)).toContain('2 plages fixées');
    seed({ windows_on: true }, ['mechanic']);
    await show();
    expect(q('windows-lock').length).toBe(0);
  });
  it('on: the numbers, the live example, the hours of the day instead of the blocks; saved with the stored blocks kept', async () => {
    seed({ windows_on: true });
    await show();
    expect(q('windows-switch')[0].getAttribute('aria-checked')).toBe('true');
    expect(q('block-am').length).toBe(0);
    expect((q('windows-before')[0] as HTMLInputElement).value).toBe('60');
    expect((q('windows-after')[0] as HTMLInputElement).value).toBe('180');
    expect(sp(q('windows-example')[0].textContent)).toBe('Arrivée estimée à 15 h → plage dite au client : entre 14 h et 18 h');
    await type('windows-before', '30');
    await type('windows-after', '210');
    expect(sp(q('windows-example')[0].textContent)).toContain('entre 14 h 30 et 18 h 30');
    await type('windows-day-start', '09:00');
    await click(q('settings-save')[0]);
    const saved = calls.find((c) => c.name === 'saveSettings')!.args[1] as Record<string, unknown>;
    // only what was changed is written: the rounding nobody touched is not added (before the rebuild every field of the
    // section was written, from whatever copy the screen held: settings-team-01)
    expect([saved.win_before_min, saved.win_after_min, saved.win_round_min, saved.windows_on]).toEqual([30, 210, undefined, true]);
    expect(saved.blocks).toEqual([{ key: 'am', start: 540, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }]);
  });
  it('a number out of range, or a day shorter than a window, is not saved', async () => {
    seed({ windows_on: true });
    await show();
    await type('windows-after', '900');
    await click(q('settings-save')[0]);
    expect(calls.some((c) => c.name === 'saveSettings')).toBe(false);
    await type('windows-after', '180');
    await type('windows-day-start', '17:00');
    await click(q('settings-save')[0]);
    expect(calls.some((c) => c.name === 'saveSettings')).toBe(false);
    expect(sp(box.textContent)).toContain('plus courte qu’une plage');
  });

  it('« Fixer les plages »: every flexible customer with a window is texted; the ones not told are listed to text by hand', async () => {
    seed({ windows_on: true }, ['office']);
    const tomorrow = addDays(today(), 1);
    const flex = (id: string, customer_id: string) => ({ id, number: 1, customer_id, day: tomorrow, block: 'day', status: 'booked', win_flex: true, win_start: 840, win_end: 1080 });
    replaceLocal('jobs', [flex('j1', 'c1'), flex('j2', 'c2')] as never);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy' }, { id: 'c2', first_name: 'Karim', last_name: 'Haddad' }] as never);
    lockAnswer = { ok: true, fixed: 1, jobs: ['j1'], untold: ['j3'] };
    notifyAnswers.j2 = { ok: false, status: 'off', message: 'Bonjour Karim…', phone: '5145551234' };
    notifyAnswers.j3 = { ok: false, code: 'not_booked' };
    await show();
    await click(q('windows-lock')[0]);
    await wait(); await wait();
    const told = calls.filter((c) => c.name === 'notify').map((c) => c.args[1]).sort();
    expect(told).toEqual(['j1', 'j2', 'j3']);
    const list = q('windows-untold')[0];
    expect(list).toBeTruthy();
    expect(sp(list.textContent)).toContain('Karim Haddad');
    expect(sp(list.textContent)).not.toContain('Julie');
    expect(list.querySelector('a')?.getAttribute('href')).toContain('sms:5145551234');
  });
  it('« Fixer les plages » pressed late: a window of today already over is not texted, one still ahead is (settings-team-st-2)', async () => {
    seed({ windows_on: true }, ['office']);
    const now = nowMinute();
    const flex = (id: string, end: number) => ({ id, number: 1, customer_id: null, day: today(), block: 'day', status: 'booked', win_flex: true, win_start: Math.max(0, end - 240), win_end: end });
    replaceLocal('jobs', [flex('gone', now - 1), flex('ahead', now + 60)] as never);
    lockAnswer = { ok: true, fixed: 0, jobs: [], untold: ['gone'] };
    await show();
    await click(q('windows-lock')[0]);
    await wait(); await wait();
    expect(calls.filter((c) => c.name === 'notify').map((c) => c.args[1])).toEqual(['ahead']);
  });
});

describe('Réglages → Réservations : two devices (settings-team-01)', () => {
  it('a number typed here, the start moved meanwhile elsewhere: saving keeps the new start', async () => {
    seed({});
    await show();
    await type('booking-horizon_days', '90');
    // the office moved the start on its phone; it reaches this device by realtime
    seed({ home: { label: 'Centrale', address: '1401 rue Legendre O.', lat: 45.5312898, lng: -73.6544639 } });
    await wait();
    await click(q('settings-save')[0]);
    const saved = calls.find((c) => c.name === 'saveSettings')!.args[1] as { horizon_days: number; home: { address: string; lat: number } };
    expect(saved.horizon_days).toBe(90);
    expect(saved.home.address).toBe('1401 rue Legendre O.');
    expect(saved.home.lat).toBe(45.5312898);
  });
  it('a garde-route limit stored at 0 stays 0 when another number is saved (settings-team-10)', async () => {
    seed({ max_hop_min: 0, max_day_drive_min: 0 });
    await show();
    expect((q('booking-max_hop_min')[0] as HTMLInputElement).value).toBe('0');
    await type('booking-horizon_days', '90');
    await click(q('settings-save')[0]);
    const saved = calls.find((c) => c.name === 'saveSettings')!.args[1] as Record<string, unknown>;
    expect([saved.max_hop_min, saved.max_day_drive_min]).toEqual([0, 0]);
  });
});
