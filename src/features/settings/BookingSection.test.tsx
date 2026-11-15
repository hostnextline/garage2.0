/* Réglages → Réservations, « Plages d’arrivée de 4 heures »: the switch (owner, behind a question), the numbers and their
   live example, « Heures de la journée » instead of the blocks, « Fixer les plages de demain ». (The server is pretended.) */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls: { name: string; args: unknown[] }[] = [];
const asked: { title: string; text?: string }[] = [];
let sayYes = true;
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    windowsSwitch: async (on: boolean) => { calls.push({ name: 'windowsSwitch', args: [on] }); return { ok: true, converted: 7 }; },
    lockWindows: async (day: string) => { calls.push({ name: 'lockWindows', args: [day] }); return { ok: true, fixed: 2 }; },
    saveSettings: async (part: string, value: unknown) => { calls.push({ name: 'saveSettings', args: [part, value] }); }
  };
});
vi.mock('../../data/sync', async (orig) => {
  const real = await orig<typeof import('../../data/sync')>();
  return { ...real, pull: async (t: string) => { calls.push({ name: 'pull', args: [t] }); }, flush: async () => undefined };
});
vi.mock('../../ui', async (orig) => {
  const real = await orig<typeof import('../../ui')>();
  return { ...real, ask: async (o: { title: string; text?: string }) => { asked.push(o); return sayYes; } };
});
vi.mock('../map/MapView', () => ({ MapView: () => null }));
vi.mock('../customers/AddressField', () => ({ AddressField: () => null }));
import { BookingSection } from './BookingSection';
import { drafts } from './SectionFrame';
import { replaceLocal } from '../../data/store';
import { access } from '../../data/auth';
import { toasts } from '../../ui/toast';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

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

beforeEach(() => { lang.value = 'fr'; calls.length = 0; asked.length = 0; sayYes = true; drafts.value = {}; toasts.value = []; });

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
    expect([saved.win_before_min, saved.win_after_min, saved.win_round_min, saved.windows_on]).toEqual([30, 210, 60, true]);
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
});
