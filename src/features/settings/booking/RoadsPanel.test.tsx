/* Réglages → Réservations, « Vraies routes » (Part 27): the state, « Mesurer maintenant », the owner's switch (measure the
   usual hours first, roads_cold once = measure and try once more), what it did (blocks kept, customers to call), every
   failure in plain words, the small settings, « Le calcul de la route » with the switch on. The function « drive » and
   roads_switch are pretended (data/roads mocked). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { DriveAnswer, DriveDone, RoadsStatus, RoadsSwitchAnswer } from '../../../data/roads';

const calls: { name: string; args: unknown[] }[] = [];
const asked: { title: string; text?: string }[] = [];
let sayYes = true;
let status: RoadsStatus | Error = { ok: true, key: true, on: false, left: 0, left0: 0, month: { month: '2026-11-01', tx: 120, cap: 10000 }, rows: { tomtom: 0, osrm: 0, none: 0 } };
let sweeps: (DriveAnswer | Error)[] = [];
let switches: (RoadsSwitchAnswer | Error)[] = [];
/** a sweep that waits for the test to let it go (to see the progress and « Arrêter ») */
let hold: Promise<void> | null = null;
/** a roads_switch that waits for the test to let it go (« Arrêter » while it is sent: review R5) */
let holdSw: Promise<void> | null = null;
/** what the server has after a pull (a switch whose answer was lost: review R6) */
let onPull: ((table: string) => void) | null = null;
vi.mock('../../../data/roads', async (orig) => {
  const real = await orig<typeof import('../../../data/roads')>();
  return {
    ...real,
    roadsStatus: async () => { calls.push({ name: 'roadsStatus', args: [] }); if (status instanceof Error) throw status; return status; },
    measureRoads: async () => {
      calls.push({ name: 'measureRoads', args: [] });
      if (hold) await hold;
      const a = sweeps.length > 1 ? sweeps.shift()! : sweeps[0];
      if (a instanceof Error) throw a;
      return a;
    },
    roadsSwitch: async (on: boolean, op?: string) => {
      calls.push({ name: 'roadsSwitch', args: [on, op] });
      if (holdSw) await holdSw;
      const a = switches.length > 1 ? switches.shift()! : switches[0];
      if (a instanceof Error) throw a;
      return a;
    }
  };
});
vi.mock('../../../data/api', async (orig) => {
  const real = await orig<typeof import('../../../data/api')>();
  return { ...real, saveSettings: async (part: string, value: unknown) => { calls.push({ name: 'saveSettings', args: [part, value] }); } };
});
vi.mock('../../../data/sync', async (orig) => {
  const real = await orig<typeof import('../../../data/sync')>();
  return { ...real, pull: async (t: string) => { calls.push({ name: 'pull', args: [t] }); onPull?.(t); }, flush: async () => undefined };
});
vi.mock('../../../ui', async (orig) => {
  const real = await orig<typeof import('../../../ui')>();
  return { ...real, ask: async (o: { title: string; text?: string }) => { asked.push(o); return sayYes; } };
});
/* Part 28 (days F6): « Je l'ai averti » on a late customer = tell_mark how 'call' (data/tell pretended) */
const marks: unknown[][] = [];
let markAnswer: (m: { id: string }[]) => Record<string, unknown> = (m) => ({ ok: true, marked: m.map((x) => x.id), changed: [], busy: [] });
vi.mock('../../../data/tell', async (orig) => {
  const real = await orig<typeof import('../../../data/tell')>();
  return { ...real, tellMark: async (m: { id: string }[]) => { marks.push(m); return markAnswer(m); } };
});
vi.mock('../../../shared/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../../shared/places/AddressField', () => ({ AddressField: () => null }));
import { BookingSection } from './BookingSection';
import { lastRoads, roadsRun } from './RoadsPanel';
import { roadsSweeping } from '../../../data/roads';
import { lastBack } from './WindowsPanel';
import { drafts } from '../SectionFrame';
import { replaceLocal } from '../../../data/store';
import { access } from '../../../data/auth';
import { toasts } from '../../../ui/toast';
import { addDays, today } from '../../../lib/dates';
import { lang } from '../../../lib/i18n';
import { Refused } from '../../../lib/errors';
import { fr } from '../../../i18n/fr';
import { en } from '../../../i18n/en';
import type { Access } from '../../../data/types';

const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
const who = (roles: string[], id = 'u1'): Access => ({ id, full_name: 'Test', short_name: 'Test', email: null, phone: null, roles, owner: roles.includes('owner'), lang: 'fr', prefs: {}, color: null,
  rights: { settings: true }, trucks: [], card_online: false, texts_online: false } as unknown as Access);
function seed(booking: Record<string, unknown>, roles = ['owner']) {
  replaceLocal('settings', [{ id: '1', booking: { blocks: BLOCKS, horizon_days: 120, speed_kmh: 35, detour: 1.3, stop_min: 5, unknown_min: 20, min_block_min: 45, near_km: 5, home: { label: 'Centrale', address: 'x', lat: 45.5, lng: -73.6 }, ...booking } } as never]);
  access.value = who(roles);
}
const done = (x: Partial<DriveDone> = {}): DriveDone => ({ ok: true, ready: false, left: 0, left0: 0, stored: 0, planned: 0, kept: [], late: [], no_road: 0,
  tomtom: 'ok', osrm: 'unused', spent: { month: '2026-11-01', tx: 0, cap: 10000 }, more: false, ...x });
const swOk = (x: Partial<RoadsSwitchAnswer> = {}): RoadsSwitchAnswer => ({ ok: true, on: true, planned: 4, kept: [], late: [], unchanged: false, ...x });
const cold = () => Object.assign(new Error('Il reste 3 trajets à mesurer avant d’allumer les vraies routes.'), { code: 'P0001', hint: 'roads_cold' });
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const one = (id: string) => q(id)[0];
const sp = (s: string | null | undefined) => String(s).replace(/\s/g, ' ');
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const settle = async () => { for (let i = 0; i < 8; i++) await wait(); };
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const type = async (id: string, v: string) => { const el = one(id) as HTMLInputElement; await act(async () => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const show = async () => { await act(async () => { render(null, box); render(<BookingSection />, box); }); await settle(); };
const names = () => calls.map((c) => (c.args.length ? `${c.name}:${c.args[0]}` : c.name));
const lastToast = () => sp(toasts.value[toasts.value.length - 1]?.text);

beforeEach(() => {
  lastBack.value = null; lastRoads.value = null; roadsRun.value = null; hold = null; holdSw = null; onPull = null; roadsSweeping.value = 0;
  lang.value = 'fr'; calls.length = 0; asked.length = 0; sayYes = true; drafts.value = {}; toasts.value = [];
  status = { ok: true, key: true, on: false, left: 0, left0: 0, month: { month: '2026-11-01', tx: 120, cap: 10000 }, rows: { tomtom: 0, osrm: 0, none: 0 } };
  sweeps = [done()]; switches = [swOk()];
  replaceLocal('jobs', []); replaceLocal('customers', []);
});

describe('« Vraies routes »: what it is and where the measures stand', () => {
  it('says what it is, the server’s key, the trips left, this month’s spend; the small settings; near in minutes only while on', async () => {
    status = { ok: true, key: true, on: false, left: 1234, left0: 56, month: { month: '2026-11-01', tx: 1880, cap: 10000 }, rows: { tomtom: 9, osrm: 0, none: 0 } };
    seed({});
    await show();
    const panel = one('booking-roads');
    expect(sp(panel.textContent)).toContain('Vraies routes');
    // what it is, in plain words, on the screen (not only behind « ? »)
    expect(sp(panel.textContent)).toContain('compte la route sur les vraies rues, avec la circulation habituelle de l’heure où le camion roule, mesurée par TomTom');
    expect(sp(panel.textContent)).toContain('sans la clé de TomTom : les vraies rues, sans la circulation');
    expect(one('roads-switch').getAttribute('aria-checked')).toBe('false');
    expect(sp(one('roads-key').textContent)).toBe('Sur le serveur');
    expect(sp(one('roads-left').textContent)).toBe('1 234 (dont 56 aux heures habituelles)');
    expect(sp(one('roads-month').textContent)).toBe('1 880 sur 10 000 transactions');
    expect(q('roads-nokey').length).toBe(0);
    expect(one('roads-rush').getAttribute('aria-checked')).toBe('true');
    expect((one('booking-roads_month_tx') as HTMLInputElement).value).toBe('10000');
    expect(q('booking-near_min').length).toBe(0);
    // « Le calcul de la route » as before: nothing marked, the help of the estimate
    expect(q('booking-speed_kmh-estimate').length).toBe(0);
    seed({ roads_on: true });
    await show();
    expect(one('roads-switch').getAttribute('aria-checked')).toBe('true');
    expect((one('booking-near_min') as HTMLInputElement).value).toBe('10');
  });
  it('the server without TomTom’s key: said in plain words', async () => {
    status = { ok: true, key: false, on: false, left: 0, left0: 0, month: { month: '2026-11-01', tx: 0, cap: 10000 }, rows: { tomtom: 0, osrm: 3, none: 0 } };
    seed({});
    await show();
    expect(sp(one('roads-key').textContent)).toBe('Pas sur le serveur');
    expect(sp(one('roads-left').textContent)).toBe('Aucun : tout est mesuré');
    expect(sp(one('roads-nokey').textContent)).toContain('sans la circulation');
  });
  it('the state cannot be read: the function not installed, no network — in plain words, with « Réessayer »', async () => {
    status = { ok: false, code: 'NOT_FOUND', error: 'Requested function was not found', at: 'drive' };
    seed({});
    await show();
    expect(sp(one('roads-error').textContent)).toContain('pas encore installée sur le serveur');
    status = new TypeError('Failed to fetch');
    await click(one('roads-retry'));
    expect(sp(one('roads-error').textContent)).toContain('Vérifie Internet');
    status = { ok: true, key: true, on: false, left: 0, left0: 0, month: null, rows: { tomtom: 0, osrm: 0, none: 0 } };
    await click(one('roads-retry'));
    expect(q('roads-error').length).toBe(0);
    expect(q('roads-state').length).toBe(1);
  });
});

describe('« Mesurer maintenant »', () => {
  it('asks the sweep again while it says « more », shows the progress, then what is left and why; the state is asked again', async () => {
    status = { ok: true, key: false, on: false, left: 60, left0: 40, month: null, rows: { tomtom: 0, osrm: 0, none: 0 } };
    sweeps = [done({ stored: 24, left: 36, left0: 16, more: true, tomtom: 'no_key', osrm: 'ok' }), done({ stored: 16, left: 20, left0: 0, tomtom: 'no_key', osrm: 'ok' })];
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-measure'));
    expect(names()).toEqual(['measureRoads', 'measureRoads', 'roadsStatus']);
    const m = sp(one('roads-message').textContent);
    // without TomTom's key the rush hours never come: said so, never « ils se mesureront plus tard » (review R3)
    expect(m).toContain('Les trajets aux heures habituelles sont mesurés.');
    expect(m).toContain('Les heures de pointe se mesurent seulement avec la clé de TomTom (ou éteins « Heures de pointe »).');
    expect(m).not.toContain('plus tard');
    expect(m).toContain('pas la clé de TomTom');
    expect(q('roads-progress').length).toBe(0);
  });
  it('while it measures: « N trajets mesurés, M à mesurer », a bar, and « Arrêter » stops it after the call under way', async () => {
    status = { ok: true, key: true, on: false, left: 48, left0: 48, month: null, rows: { tomtom: 0, osrm: 0, none: 0 } };
    sweeps = [done({ stored: 24, left: 24, left0: 24, more: true })];
    let go!: () => void, go2!: () => void;
    hold = new Promise<void>((r) => { go = r; });
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-measure'));
    expect(sp(one('roads-progress').textContent)).toContain('Mesure en cours');
    expect(q('roads-measure').length).toBe(0);
    expect((one('roads-switch') as HTMLButtonElement).disabled).toBe(true);
    // the first round answers; the second one waits
    hold = new Promise<void>((r) => { go2 = r; });
    go();
    await settle();
    expect(sp(one('roads-progress').textContent)).toContain('24 trajets mesurés, 24 à mesurer');
    expect(one('roads-progress').querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    // the person stops it: the round under way ends, no new one starts
    await click(one('roads-stop'));
    hold = null;
    go2();
    await settle();
    expect(names().filter((n) => n === 'measureRoads').length).toBe(2);
    expect(q('roads-progress').length).toBe(0);
    expect(sp(one('roads-message').textContent)).toContain('Mesure arrêtée. 24 trajets restent à mesurer.');
  });
  it('the person leaves the screen: the round under way ends, no new one starts; the message waits for the way back', async () => {
    status = { ok: true, key: true, on: false, left: 48, left0: 48, month: null, rows: { tomtom: 0, osrm: 0, none: 0 } };
    sweeps = [done({ stored: 24, left: 24, left0: 24, more: true })];
    let go!: () => void;
    hold = new Promise<void>((r) => { go = r; });
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-measure'));
    await act(async () => { render(null, box); });
    hold = null;
    go();
    await settle();
    expect(names().filter((n) => n === 'measureRoads').length).toBe(1);
    expect(roadsRun.value).toBeNull();
    await show();
    expect(sp(one('roads-message').textContent)).toContain('La mesure s’est arrêtée quand tu as quitté l’écran : 24 trajets restent. Touche « Mesurer maintenant » pour continuer.');
    expect(q('roads-progress').length).toBe(0);
  });
  it('back on the screen before the round ended: it goes on', async () => {
    sweeps = [done({ stored: 24, left: 24, left0: 24, more: true }), done({ stored: 24, left: 0, left0: 0 })];
    let go!: () => void;
    hold = new Promise<void>((r) => { go = r; });
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-measure'));
    await act(async () => { render(null, box); });
    await show();
    expect(sp(one('roads-progress').textContent)).toContain('Mesure en cours');
    hold = null;
    go();
    await settle();
    expect(names().filter((n) => n === 'measureRoads').length).toBe(2);
    expect(sp(one('roads-message').textContent)).toContain('Tous les trajets à venir sont mesurés.');
  });
  it('the background sweep of this device is measuring: « Mesurer maintenant » waits for it, said why', async () => {
    seed({});
    await show();
    await act(async () => { roadsSweeping.value = 1; });
    expect((one('roads-measure') as HTMLButtonElement).disabled).toBe(true);
    expect(sp(one('roads-background').textContent)).toContain('déjà en arrière-plan');
    await act(async () => { roadsSweeping.value = 0; });
    expect((one('roads-measure') as HTMLButtonElement).disabled).toBe(false);
    expect(q('roads-background').length).toBe(0);
  });
  it('a refusal or no network: said, nothing else happens', async () => {
    sweeps = [{ ok: false, code: 'NOT_FOUND', error: 'Requested function was not found', at: 'drive' }];
    seed({});
    await show();
    await click(one('roads-measure'));
    expect(sp(one('roads-message').textContent)).toContain('La mesure n’a pas marché.');
    expect(sp(one('roads-message').textContent)).toContain('pas encore installée');
    sweeps = [new TypeError('Failed to fetch')];
    await click(one('roads-measure'));
    expect(sp(one('roads-message').textContent)).toContain('Vérifie Internet');
    await click(one('roads-message-close'));
    expect(q('roads-message').length).toBe(0);
  });
  it('TomTom and OSRM both down: nothing measured, said plainly', async () => {
    status = { ok: true, key: true, on: false, left: 30, left0: 30, month: null, rows: { tomtom: 0, osrm: 0, none: 0 } };
    sweeps = [done({ left: 30, left0: 30, tomtom: 'busy', osrm: 'down' })];
    seed({});
    await show();
    await click(one('roads-measure'));
    expect(sp(one('roads-message').textContent)).toContain('Ni TomTom ni l’autre service de routes (OSRM) ne répondent');
  });
  it('the office may measure, not switch; a mechanic sees no button', async () => {
    seed({}, ['office']);
    await show();
    expect((one('roads-switch') as HTMLButtonElement).disabled).toBe(true);
    expect(sp(box.textContent)).toContain('Seul le propriétaire peut changer ce choix.');
    expect(q('roads-measure').length).toBe(1);
    seed({}, ['mechanic']);
    await show();
    expect(q('roads-measure').length).toBe(0);
  });
});

describe('the switch', () => {
  it('ON: the question first; then the usual hours measured, roads_switch, the settings and the jobs pulled, the toast', async () => {
    status = { ok: true, key: true, on: false, left: 70, left0: 30, month: null, rows: { tomtom: 0, osrm: 0, none: 0 } };
    sweeps = [done({ stored: 24, left: 46, left0: 6, more: true }), done({ stored: 6, left: 40, left0: 0, more: true })];
    switches = [swOk({ planned: 5 })];
    seed({});
    await show();
    calls.length = 0;
    sayYes = false;
    await click(one('roads-switch'));
    expect(asked.length).toBe(1);
    expect(sp(asked[0].title)).toBe('Compter les vraies routes ?');
    expect(sp(asked[0].text)).toContain('mesure d’abord les trajets');
    expect(sp(asked[0].text)).toContain('revenir à l’estimation');
    expect(calls.length).toBe(0);
    sayYes = true;
    await click(one('roads-switch'));
    // the rush hours are not waited for: two rounds (left0 reaches 0), not three
    expect(names()).toEqual(['measureRoads', 'measureRoads', 'roadsSwitch:true', 'pull:settings', 'pull:jobs', 'roadsStatus']);
    expect(lastToast()).toBe('Vraies routes allumées : 5 moments replanifiés.');
    // what it did stays on screen too (the toast goes away)
    expect(sp(one('roads-message').textContent)).toContain('Vraies routes allumées : 5 moments replanifiés.');
    await act(async () => { render(null, box); });
    await show();
    expect(sp(one('roads-message').textContent)).toContain('Vraies routes allumées : 5 moments replanifiés.');
  });
  it('ON refused roads_cold (an address added meanwhile): measured once more, asked once more', async () => {
    sweeps = [done({ left: 0, left0: 0 })];
    switches = [cold(), swOk({ planned: 1 })];
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    expect(names()).toEqual(['measureRoads', 'roadsSwitch:true', 'measureRoads', 'roadsSwitch:true', 'pull:settings', 'pull:jobs', 'roadsStatus']);
    expect(lastToast()).toBe('Vraies routes allumées : 1 moment replanifié.');
  });
  it('ON refused roads_cold twice: not on, said what to do; never a third try', async () => {
    switches = [cold()];
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    expect(names().filter((n) => n.startsWith('roadsSwitch'))).toEqual(['roadsSwitch:true', 'roadsSwitch:true']);
    const m = sp(one('roads-message').textContent);
    expect(m).toContain('Les vraies routes ne sont pas allumées.');
    expect(m).toContain('Une adresse vient d’être ajoutée');
    expect(names()).not.toContain('pull:settings');
  });
  it('ON, the person leaves the screen while the usual hours are measured: never switched, said on the way back', async () => {
    sweeps = [done({ stored: 10, left: 20, left0: 20, more: true })];
    let go!: () => void;
    hold = new Promise<void>((r) => { go = r; });
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    await act(async () => { render(null, box); });
    hold = null;
    go();
    await settle();
    expect(names()).toEqual(['measureRoads']);
    await show();
    const m = sp(one('roads-message').textContent);
    expect(m).toContain('Les vraies routes ne sont pas allumées.');
    expect(m).toContain('quitté l’écran, avant d’allumer');
    expect(one('roads-switch').getAttribute('aria-checked')).toBe('false');
  });
  it('ON while the usual hours cannot be measured (function missing, both services down, stuck): never switched', async () => {
    seed({});
    for (const [a, words] of [
      [{ ok: false, code: 'NOT_FOUND', error: 'Requested function was not found', at: 'drive' }, 'pas encore installée'],
      [done({ left: 12, left0: 12, tomtom: 'busy', osrm: 'down' }), 'Ni TomTom ni'],
      [new TypeError('Failed to fetch'), 'Vérifie Internet']
    ] as [DriveAnswer | Error, string][]) {
      sweeps = [a];
      await show();
      calls.length = 0;
      await click(one('roads-switch'));
      expect(names()).not.toContain('roadsSwitch:true');
      const m = sp(one('roads-message').textContent);
      expect(m).toContain('Les vraies routes ne sont pas allumées.');
      expect(m).toContain(words);
    }
  });
  it('what it did: the customers now late (names, the moment told, the new arrival, call / text) and the blocks kept, until « Fermer »', async () => {
    const tomorrow = addDays(today(), 1);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'fr' }, { id: 'c2', first_name: 'Karim', last_name: 'Haddad', phone: null, lang: 'en' }] as never);
    replaceLocal('jobs', [{ id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'am', status: 'booked', eta_min: 745 }, { id: 'j2', number: 42, customer_id: 'c2', day: tomorrow, block: 'pm', status: 'booked', eta_min: 970 }] as never);
    switches = [swOk({ planned: 3, kept: [{ day: tomorrow, block: 'eve' }], late: ['j1', 'j2'] })];
    seed({});
    await show();
    await click(one('roads-switch'));
    expect(sp(one('roads-late').textContent)).toContain('2 clients à rappeler : ils arrivent maintenant plus tard que le moment qu’on leur a dit.');
    const rows = q('roads-late-row');
    expect(rows.length).toBe(2);
    expect(sp(rows[0].textContent)).toContain('Julie Roy');
    expect(sp(rows[0].textContent)).toContain('Dit : demain matin (8 h à 12 h)');
    expect(sp(rows[0].textContent)).toContain('Arrivée prévue : 12 h 25');
    const links = [...rows[0].querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
    expect(links[0]).toMatch(/^tel:\+?1?5145551234$/);
    expect(decodeURIComponent(links[1])).toContain('le mécanicien arrivera vers 12 h 25');
    expect(sp(rows[1].textContent)).toContain('Karim Haddad');
    expect(sp(rows[1].textContent)).toContain('Pas de numéro');
    expect(sp(one('roads-kept').textContent)).toContain('Demain soir');
    // kept for the visit (leaving Réglages and coming back), per account
    await act(async () => { render(null, box); });
    await show();
    expect(q('roads-late-row').length).toBe(2);
    access.value = who(['owner'], 'u2');
    await show();
    expect(q('roads-late').length + q('roads-kept').length).toBe(0);
    access.value = who(['owner']);
    await show();
    await click(one('roads-late-close'));
    expect(q('roads-late').length).toBe(0);
    expect(q('roads-kept').length).toBe(1);
    await click(one('roads-kept-close'));
    expect(q('roads-kept').length).toBe(0);
  });
  it('OFF: the question, roads_switch(false) at once (nothing to measure), the same report', async () => {
    switches = [swOk({ on: false, planned: 2 })];
    seed({ roads_on: true });
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    expect(sp(asked[0].title)).toBe('Revenir à l’estimation ?');
    expect(names()).toEqual(['roadsSwitch:false', 'pull:settings', 'pull:jobs', 'roadsStatus']);
    expect(lastToast()).toBe('Retour à l’estimation : 2 moments replanifiés.');
    expect(sp(one('roads-message').textContent)).toContain('Retour à l’estimation : 2 moments replanifiés.');
  });
  it('OFF with a block kept: its arrival times follow the estimate (not « the real roads »)', async () => {
    const tomorrow = addDays(today(), 1);
    switches = [swOk({ on: false, planned: 1, kept: [{ day: tomorrow, block: 'am' }] })];
    seed({ roads_on: true });
    await show();
    await click(one('roads-switch'));
    const k = sp(one('roads-kept').textContent);
    expect(k).toContain('Ses heures d’arrivée suivent l’estimation');
    expect(k).not.toContain('vraies routes');
  });
  it('already on (another phone switched it meanwhile): said, nothing else to do', async () => {
    switches = [swOk({ planned: 0, unchanged: true })];
    seed({});
    await show();
    await click(one('roads-switch'));
    expect(lastToast()).toBe('Les vraies routes étaient déjà allumées.');
    expect(sp(one('roads-message').textContent)).toContain('Les vraies routes étaient déjà allumées.');
  });
  it('OFF refused (no network, « Voir l’app comme… »): said in plain words', async () => {
    switches = [Object.assign(new TypeError('Failed to fetch'))];
    seed({ roads_on: true });
    await show();
    await click(one('roads-switch'));
    expect(sp(one('roads-message').textContent)).toContain('Les vraies routes restent allumées.');
    expect(sp(one('roads-message').textContent)).toContain('Pas de connexion au serveur');
    switches = [new Refused('preview', 'Pas possible en « Voir l’app comme… ».')];
    await click(one('roads-switch'));
    expect(sp(one('roads-message').textContent)).toContain('Voir l’app comme');
  });
  it('someone who is not the owner cannot switch', async () => {
    seed({}, ['office']);
    await show();
    await click(one('roads-switch'));
    expect(asked.length).toBe(0);
    expect(names()).not.toContain('roadsSwitch:true');
  });
});

describe('the customers to call: « Je l\'ai averti » (Part 28, days F6, U11)', () => {
  it('marks the customer told by call, with the hours the phone says he must be told now; then the row says so', async () => {
    const tomorrow = addDays(today(), 1);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'fr' }] as never);
    // told 8 h à 12 h (a block, then the windows), now a sure arrival at 12 h 25 outside it: told the window of that arrival
    replaceLocal('jobs', [{ id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'day', status: 'booked', eta_min: 745, win_start: 480, win_end: 720,
      told_day: tomorrow, told_start: 480, told_end: 720, told_at: '2026-11-20T10:00:00-05:00', told_how: 'sms' }] as never);
    switches = [swOk({ planned: 1, late: ['j1'] })];
    seed({ windows_on: true });
    marks.length = 0;
    markAnswer = (m) => ({ ok: true, marked: m.map((x) => x.id), changed: [], busy: [] });
    await show();
    await click(one('roads-switch'));
    expect(q('roads-late-row').length).toBe(1);
    await click(one('roads-late-mark'));
    expect(marks).toEqual([[{ id: 'j1', how: 'call', kind: 'moved', day: tomorrow, start: 660, end: 900 }]]);
    expect(lastToast()).toContain('Noté : Julie Roy a son heure.');
    expect(q('roads-late-mark').length).toBe(0);
    expect(sp(one('roads-late-told').textContent)).toContain('Déjà averti : Julie Roy');
  });
  it('the hours changed meanwhile: not marked, the row keeps its button', async () => {
    const tomorrow = addDays(today(), 1);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'fr' }] as never);
    replaceLocal('jobs', [{ id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'am', status: 'booked', eta_min: 745 }] as never);
    switches = [swOk({ planned: 1, late: ['j1'] })];
    seed({});
    marks.length = 0;
    markAnswer = (m) => ({ ok: true, marked: [], changed: m.map((x) => x.id), busy: [] });
    await show();
    await click(one('roads-switch'));
    await click(one('roads-late-mark'));
    expect(marks.length).toBe(1);
    expect(lastToast()).toContain('a changé entre-temps');
    expect(q('roads-late-mark').length).toBe(1);
  });
});

describe('the small settings and « Le calcul de la route »', () => {
  it('rush hours, the month’s ceiling, near in minutes: saved with « Enregistrer », only what changed, never roads_on', async () => {
    seed({ roads_on: true });
    await show();
    await click(one('roads-rush'));
    await type('booking-roads_month_tx', '2500');
    await type('booking-near_min', '8');
    await click(one('settings-save'));
    const saved = calls.find((c) => c.name === 'saveSettings')!.args[1] as Record<string, unknown>;
    expect([saved.roads_rush, saved.roads_month_tx, saved.near_min, saved.roads_on]).toEqual([false, 2500, 8, true]);
    // the rush hours count for the planner while on: the coming routes are planned again
    expect(lastToast()).toBe('Réglages enregistrés. Les tournées à venir sont recalculées.');
  });
  it('switch on: speed, detour and the « near » distance are marked, not hidden; the help says the real roads; changing them re-plans nothing', async () => {
    seed({ roads_on: true });
    await show();
    for (const k of ['speed_kmh', 'detour_pct', 'near_km']) {
      expect(q(`booking-${k}`).length).toBe(1);
      expect(sp(one(`booking-${k}-estimate`).textContent)).toBe('Utilisé seulement sans les vraies routes');
    }
    expect(q('booking-stop_min-estimate').length).toBe(0);
    // the « ? » of the panel and of « Trajet inconnu »: the real roads' texts
    const bubble = async (el: Element | null) => { await click(el as HTMLElement); const t = sp(document.querySelector('.help-pop')?.textContent); await click(el as HTMLElement); return t; };
    const planHelp = await bubble(one('booking-plan').querySelector('.panel-title .help'));
    expect(planHelp).toContain('Les vraies routes sont allumées');
    expect(planHelp).not.toContain('ligne droite');
    const unknownHelp = await bubble(one('booking-unknown_min').closest('.field')!.querySelector('.help'));
    expect(unknownHelp).toContain('ou pour un trajet pas encore mesuré');
    await type('booking-speed_kmh', '40');
    await click(one('settings-save'));
    expect(lastToast()).toBe('Réglages enregistrés.');
    seed({});
    await show();
    expect(q('booking-speed_kmh-estimate').length).toBe(0);
  });
  it('a ceiling out of range is not saved', async () => {
    seed({});
    await show();
    await type('booking-roads_month_tx', '-5');
    await click(one('settings-save'));
    expect(calls.some((c) => c.name === 'saveSettings')).toBe(false);
  });
});

describe('the words of « Vraies routes »', () => {
  it('French and English have the same keys, no straight-line words, no empty sentence', () => {
    const keys = (o: unknown, p = ''): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    const f = fr.settings.booking.roads, e = en.settings.booking.roads;
    expect(keys(e).sort()).toEqual(keys(f).sort());
    const all = (o: unknown): string[] => Object.values(o as Record<string, unknown>).flatMap((v) => (v && typeof v === 'object' ? all(v) : [String(v)]));
    // the route estimate's own words too, switch on OR off (CONTRACT §0; review R10)
    const plan = [fr.settings.booking.planHelp, en.settings.booking.planHelp, fr.settings.booking.detourHelp, en.settings.booking.detourHelp, fr.settings.booking.speedHelp, en.settings.booking.speedHelp];
    for (const s of [...all(f), ...all(e), ...plan, fr.settings.booking.planHelpRoads, en.settings.booking.planHelpRoads, fr.settings.booking.unknownHelpRoads, en.settings.booking.unknownHelpRoads]) {
      expect(s.trim().length).toBeGreaterThan(0);
      expect(s).not.toMatch(/vol d.oiseau|crow flies|ligne droite|straight line/i);
    }
    expect(fr.settings.booking.unknownHelpRoads).toContain('ou pour un trajet pas encore mesuré');
    expect(fr.settings.booking.roads.onlyEstimate).toBe('Utilisé seulement sans les vraies routes');
  });
});

/* review-settings, round 3b: each test failed on the code it was written against (the reviewer's proofs P1, P2, P3, P6, P7
   turned around), then the fix made it pass. */
describe('review-settings round 3b', () => {
  const tomorrow = addDays(today(), 1);
  const people = () => {
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'fr' }, { id: 'c2', first_name: 'Karim', last_name: 'Haddad', phone: null, lang: 'en' }] as never);
    replaceLocal('jobs', [{ id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'am', status: 'booked', eta_min: 745 }, { id: 'j2', number: 42, customer_id: 'c2', day: tomorrow, block: 'pm', status: 'booked', eta_min: 970 }] as never);
  };
  it('R1 a new run never wipes the customers « à rappeler » nor the blocks kept (only their « Fermer » does); it adds its own', async () => {
    people();
    switches = [swOk({ planned: 3, late: ['j1'], kept: [{ day: tomorrow, block: 'eve' }] })];
    seed({});
    await show();
    await click(one('roads-switch'));
    expect(q('roads-late-row').length).toBe(1);
    // the switch is on now; « Mesurer maintenant » before anyone called Julie
    seed({ roads_on: true });
    sweeps = [done({ stored: 4, left: 0, left0: 0, planned: 1, late: ['j2', 'j1'] })];
    let go!: () => void;
    hold = new Promise<void>((r) => { go = r; });
    await show();
    await click(one('roads-measure'));
    // while it measures, the list stays
    expect(q('roads-progress').length).toBe(1);
    expect(q('roads-late-row').length).toBe(1);
    hold = null;
    go();
    await settle();
    // the new run's late customer is added (each one once), the kept block stays, the message is the new run's
    expect(q('roads-late-row').map((r) => sp(r.querySelector('b')?.textContent))).toEqual(['Julie Roy', 'Karim Haddad']);
    expect(sp(one('roads-late').textContent)).toContain('2 clients à rappeler');
    expect(q('roads-kept').length).toBe(1);
    expect(sp(one('roads-message').textContent)).toContain('Tous les trajets à venir sont mesurés.');
    // closing the message keeps the lists; a failure does not wipe them either
    await click(one('roads-message-close'));
    expect(q('roads-late-row').length).toBe(2);
    sweeps = [new TypeError('Failed to fetch')];
    await click(one('roads-measure'));
    expect(sp(one('roads-message').textContent)).toContain('Vérifie Internet');
    expect(q('roads-late-row').length).toBe(2);
    // only « Fermer » of the list takes it away, and a later run does not bring it back
    await click(one('roads-late-close'));
    expect(q('roads-late').length).toBe(0);
    sweeps = [done({ stored: 0, left: 0, left0: 0 })];
    await click(one('roads-measure'));
    expect(q('roads-late').length).toBe(0);
    expect(q('roads-kept').length).toBe(1);
    await click(one('roads-kept-close'));
    expect(q('roads-kept').length).toBe(0);
  });
  it('R2 the month’s TomTom ceiling (money) is the owner’s, like the switch: read only for the office, with why', async () => {
    seed({}, ['office']);
    await show();
    const input = one('booking-roads_month_tx') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(sp(input.closest('.field')?.textContent)).toContain('Seul le propriétaire peut changer ce choix.');
    // the rush hours stay a setting of the section (the « settings » right), like the route estimate
    expect((one('roads-rush') as HTMLButtonElement).disabled).toBe(false);
    seed({}, ['owner']);
    await show();
    expect((one('booking-roads_month_tx') as HTMLInputElement).disabled).toBe(false);
    expect(sp(one('booking-roads_month_tx').closest('.field')?.textContent)).not.toContain('Seul le propriétaire');
  });
  it('the public page’s TomTom budget (roads_web_tx) beside the month’s ceiling: the same kind of field, owner only (decision of 19:20)', async () => {
    seed({}, ['owner']);
    await show();
    const web = one('booking-roads_web_tx') as HTMLInputElement;
    expect(web.value).toBe('1000');
    expect(web.disabled).toBe(false);
    const field = sp(web.closest('.field')?.textContent);
    expect(field).toContain('Enveloppe du mois pour la réservation en ligne');
    // beside the ceiling: the next field of the same grid
    const grid = one('booking-roads_month_tx').closest('.settings-grid-3')!;
    expect(grid.contains(web)).toBe(true);
    await type('booking-roads_web_tx', '400');
    await click(one('settings-save'));
    const saved = calls.find((c) => c.name === 'saveSettings')!.args[1] as Record<string, unknown>;
    expect(saved.roads_web_tx).toBe(400);
    expect('roads_month_tx' in saved).toBe(false);
    seed({ roads_web_tx: 250 }, ['office']);
    await show();
    const locked = one('booking-roads_web_tx') as HTMLInputElement;
    expect(locked.value).toBe('250');
    expect(locked.disabled).toBe(true);
    expect(sp(locked.closest('.field')?.textContent)).toContain('Seul le propriétaire peut changer ce choix.');
    lang.value = 'en';
    seed({}, ['owner']);
    await show();
    expect(sp(one('booking-roads_web_tx').closest('.field')?.textContent)).toContain('Online booking allowance for the month');
  });
  it('R3 the server without TomTom’s key: « Trajets à mesurer » counts only what can be measured, and says why the rush hours wait', async () => {
    status = { ok: true, key: false, on: false, left: 20, left0: 0, month: { month: '2026-11-01', tx: 0, cap: 10000 }, rows: { tomtom: 0, osrm: 30, none: 0 } };
    seed({});
    await show();
    expect(sp(one('roads-left').textContent)).toBe('Aucun aux heures habituelles');
    expect(sp(one('roads-rush-never').textContent)).toBe('Les heures de pointe se mesurent seulement avec la clé de TomTom (ou éteins « Heures de pointe »).');
    // a ceiling of 0 (« jamais TomTom ») the same way
    status = { ok: true, key: true, on: false, left: 30, left0: 12, month: { month: '2026-11-01', tx: 0, cap: 0 }, rows: { tomtom: 0, osrm: 30, none: 0 } };
    await show();
    expect(sp(one('roads-left').textContent)).toBe('12 aux heures habituelles');
    expect(sp(one('roads-rush-never').textContent)).toContain('le plafond du mois chez TomTom est à 0');
    // the rush hours switched off: nothing to say about them
    seed({ roads_rush: false });
    await show();
    expect(q('roads-rush-never').length).toBe(0);
    // with the key, as before
    status = { ok: true, key: true, on: false, left: 30, left0: 12, month: { month: '2026-11-01', tx: 0, cap: 10000 }, rows: { tomtom: 0, osrm: 0, none: 0 } };
    seed({});
    await show();
    expect(sp(one('roads-left').textContent)).toBe('30 (dont 12 aux heures habituelles)');
    expect(q('roads-rush-never').length).toBe(0);
  });
  it('R5 once roads_switch is sent there is no « Arrêter » any more: « Changement en cours… »', async () => {
    sweeps = [done({ stored: 3, left: 0, left0: 0 })];
    switches = [swOk({ planned: 1 })];
    let go!: () => void;
    holdSw = new Promise<void>((r) => { go = r; });
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    expect(sp(one('roads-progress').textContent)).toContain('Changement en cours');
    expect(q('roads-stop').length).toBe(0);
    holdSw = null;
    go();
    await settle();
    expect(names()).toEqual(['measureRoads', 'roadsSwitch:true', 'pull:settings', 'pull:jobs', 'roadsStatus']);
  });
  it('R5 « Arrêter » during the last round of the measure: the switch is not sent', async () => {
    sweeps = [done({ stored: 3, left: 0, left0: 0 })];
    let go!: () => void;
    hold = new Promise<void>((r) => { go = r; });
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    await click(one('roads-stop'));
    hold = null;
    go();
    await settle();
    expect(names()).toEqual(['measureRoads', 'roadsStatus']);
    const m = sp(one('roads-message').textContent);
    expect(m).toContain('Les vraies routes ne sont pas allumées.');
    expect(m).toContain('Mesure arrêtée.');
  });
  it('R5 roads_cold, then « Arrêter » during the measure of the retry: never switched on (the stop is not erased)', async () => {
    sweeps = [done({ stored: 3, left: 0, left0: 0 })];
    switches = [cold(), swOk({ planned: 1 })];
    let go1!: () => void, go2!: () => void;
    hold = new Promise<void>((r) => { go1 = r; });
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    hold = new Promise<void>((r) => { go2 = r; });
    go1();
    await settle();
    // the first roads_switch was refused roads_cold: the retry's measure is under way
    expect(names()).toEqual(['measureRoads', 'roadsSwitch:true', 'measureRoads']);
    await click(one('roads-stop'));
    hold = null;
    go2();
    await settle();
    expect(names()).toEqual(['measureRoads', 'roadsSwitch:true', 'measureRoads', 'roadsStatus']);
    expect(sp(one('roads-message').textContent)).toContain('Les vraies routes ne sont pas allumées.');
    expect(one('roads-switch').getAttribute('aria-checked')).toBe('false');
  });
  it('R6 the answer of roads_switch lost (connection cut after the server did it): the settings are pulled, the screen says what the server has', async () => {
    switches = [new TypeError('Failed to fetch')];
    seed({});
    await show();
    calls.length = 0;
    onPull = (table) => { if (table === 'settings') seed({ roads_on: true }); };
    await click(one('roads-switch'));
    expect(names()).toContain('pull:settings');
    expect(names()).toContain('pull:jobs');
    const m = sp(one('roads-message').textContent);
    expect(m).toContain('Les vraies routes sont allumées sur le serveur');
    expect(m).toContain('la liste des clients à rappeler n’a pas pu venir');
    expect(m).not.toContain('ne sont pas allumées');
    expect(one('roads-switch').getAttribute('aria-checked')).toBe('true');
  });
  it('R6 not known (still no connection): « pas allumées » and why; the retry that finds it already on says the list could not come', async () => {
    switches = [new TypeError('Failed to fetch')];
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    expect(names()).toContain('pull:settings');
    let m = sp(one('roads-message').textContent);
    expect(m).toContain('Les vraies routes ne sont pas allumées.');
    expect(m).toContain('Vérifie Internet');
    // the connection is back: the first try HAD reached the server, the retry is told « unchanged »
    switches = [swOk({ unchanged: true, planned: 0 })];
    await click(one('roads-switch'));
    m = sp(one('roads-message').textContent);
    expect(m).toContain('Les vraies routes sont allumées sur le serveur');
    expect(m).toContain('la liste des clients à rappeler n’a pas pu venir');
    expect(m).not.toContain('déjà allumées');
    // a plain « already on » (no try lost before) keeps its words
    switches = [swOk({ unchanged: true, planned: 0 })];
    seed({});
    await show();
    await click(one('roads-switch'));
    expect(sp(one('roads-message').textContent)).toContain('Les vraies routes étaient déjà allumées.');
  });
  /* R6, second half (the integrator, 2026-11-20): the SAME operation is asked again, so the server's first answer — its list
     of customers to call — comes back (roads_switch keeps an op's answer: op_begin) */
  const swOps = () => calls.filter((c) => c.name === 'roadsSwitch').map((c) => c.args[1] as string | undefined);
  const lateJob = () => {
    const tomorrow = addDays(today(), 1);
    replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '514 555-1234', lang: 'fr' }] as never);
    replaceLocal('jobs', [{ id: 'j1', number: 41, customer_id: 'c1', day: tomorrow, block: 'am', status: 'booked', eta_min: 745 }] as never);
  };
  it('R6 op: the answer lost, the server has it ON: the same op is asked again at once and its list of customers to call comes', async () => {
    lateJob();
    switches = [new TypeError('Failed to fetch'), swOk({ planned: 3, late: ['j1'] })];
    seed({});
    await show();
    calls.length = 0;
    onPull = (table) => { if (table === 'settings') seed({ roads_on: true }); };
    await click(one('roads-switch'));
    const ops = swOps();
    expect(ops).toHaveLength(2);
    expect(typeof ops[0]).toBe('string');
    expect(ops[1]).toBe(ops[0]);
    const m = sp(one('roads-message').textContent);
    expect(m).toContain('Vraies routes allumées : 3 moments replanifiés.');
    expect(m).not.toContain('n’a pas pu venir');
    expect(q('roads-late-row').map((r) => sp(r.querySelector('b')?.textContent))).toEqual(['Julie Roy']);
  });
  it('R6 op: still no connection, then a later tap: the SAME op is sent (the server answers the first one), the list comes', async () => {
    lateJob();
    switches = [new TypeError('Failed to fetch')];
    seed({});
    await show();
    calls.length = 0;
    await click(one('roads-switch'));
    expect(sp(one('roads-message').textContent)).toContain('Les vraies routes ne sont pas allumées.');
    switches = [swOk({ planned: 2, late: ['j1'] })];
    await click(one('roads-switch'));
    const ops = swOps();
    expect(ops.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ops).size).toBe(1);
    expect(sp(one('roads-message').textContent)).toContain('Vraies routes allumées : 2 moments replanifiés.');
    expect(q('roads-late-row').length).toBe(1);
    // the answer came: the next tap is a new operation
    seed({});
    await show();
    switches = [swOk()];
    await click(one('roads-switch'));
    const after = swOps();
    expect(after[after.length - 1]).not.toBe(ops[0]);
  });
  it('R6 op: a lost OFF is never reused for an ON (another direction = a new op), nor after a refusal', async () => {
    switches = [new TypeError('Failed to fetch')];
    seed({ roads_on: true });
    await show();
    calls.length = 0;
    await click(one('roads-switch'));                                   // OFF, the answer lost, the server still on
    const lostOff = swOps()[0];
    expect(typeof lostOff).toBe('string');
    seed({});                                                           // someone turned it off meanwhile (another device)
    await show();
    switches = [cold()];                                                // ON refused twice: roads_cold
    await click(one('roads-switch'));
    const onOps = swOps().slice(1);
    expect(onOps.length).toBe(2);
    expect(onOps).not.toContain(lostOff);
    expect(onOps[0]).not.toBe(onOps[1]);                                // a refusal is not « lost »: the retry is a new op
  });
  it('R11 the question before ON says to stay on the screen until it ends (leaving cancels it)', async () => {
    seed({});
    await show();
    sayYes = false;
    await click(one('roads-switch'));
    expect(sp(asked[0].text)).toContain('Reste sur cet écran jusqu’à la fin.');
    lang.value = 'en';
    await show();
    await click(one('roads-switch'));
    expect(sp(asked[1].text)).toContain('Stay on this screen until it ends.');
  });
});
