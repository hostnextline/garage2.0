/* « Réorganiser la journée » (Part 28, REARRANGE.md §2.4-§2.7, U4): every state of §2.5 on the sheet, the buttons of §2.6,
   someone else changing the day (§2.7) and the draft kept on the phone. The server (day_order_preview, day_order_save) is
   pretended; its answers are read by the real parser (src/data/dayOrder.ts). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const h = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
  warm: vi.fn(() => Promise.resolve({ ok: true, ready: true })),
  pull: vi.fn(() => Promise.resolve()),
  openTell: vi.fn()
}));
vi.mock('../../data/dayOrder', async (orig) => ({
  ...(await orig<typeof import('../../data/dayOrder')>()),
  dayOrderPreview: h.preview, dayOrderSave: h.save, DAY_ORDER_WAIT_MS: 30, DAY_ORDER_LOCK_RETRY_MS: 30, DAY_ORDER_DEADLOCK_RETRY_MS: 30
}));
vi.mock('../../data/roads', async (orig) => ({ ...(await orig<typeof import('../../data/roads')>()), warmRoads: h.warm }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), pull: h.pull }));
vi.mock('./exactMove', async (orig) => ({ ...(await orig<typeof import('./exactMove')>()), PREVIEW_WAIT_MS: 300 }));
vi.mock('./TellHost', () => ({ openTell: h.openTell }));

import { DayOrderSheet } from './DayOrderSheet';
import { dayAnswer } from '../../data/dayOrder';
import { replaceLocal, upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { setNet } from '../../data/net';
import { AskHost } from '../../ui/ask';
import { ContextMenuHost } from '../../ui/ContextMenu';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';
import { addDays, clock, today } from '../../lib/dates';
import { movesWaiting } from './moving';
import type { Access, Job } from '../../data/types';

const DAY = addDays(today(), 3);
const owner = { id: 'u-hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'u-saleh', owner: false, roles: ['mechanic'], rights: {}, trucks: ['A'] } as unknown as Access;
const TOLD = '2026-11-01T10:00:00.000Z';
/** a booked stop told exactly its window (nothing due), on truck A by default */
const J = (id: string, number: number, first: string, stop: number, o: Partial<Job> = {}) => ({
  id, number, customer_id: `c-${id}`, truck_id: 'A', day: DAY, block: 'day', status: 'booked', stop_order: stop, duration_min: 60, travel_min: 20,
  eta_min: 480 + stop * 60, win_start: 480, win_end: 720, win_flex: false, arrive_at: null, deleted_at: null,
  told_day: DAY, told_start: 480, told_end: 720, told_at: TOLD, told_how: 'sms', _first: first, ...o
}) as unknown as Job & { _first: string };
const world = () => [
  J('live', 10, 'Alice', 1, { status: 'on_site' }),
  J('a', 11, 'Benoit', 2), J('b', 12, 'Chloe', 3), J('c', 13, 'Denis', 4),
  J('d', 21, 'Omar', 1, { truck_id: 'B' })
];
function seed(jobs = world(), booking: Record<string, unknown> = {}) {
  replaceLocal('settings', [{ id: '1', booking: { windows_on: true, roads_on: false, win_before_min: 60, win_after_min: 180, win_round_min: 60, ...booking }, messages: { on: {} } }] as never);
  replaceLocal('trucks', [
    { id: 'A', name: 'Camion Complet', active: true, sort: 1, tire_machine: true },
    { id: 'B', name: 'Voiture', active: true, sort: 2, tire_machine: false }
  ] as never);
  const dow = new Date(`${DAY}T12:00:00Z`).getUTCDay();
  replaceLocal('truck_week', [{ id: 'wa', truck_id: 'A', dow, ranges: [[480, 1020]] }, { id: 'wb', truck_id: 'B', dow, ranges: [[480, 1020]] }] as never);
  replaceLocal('truck_days', [] as never);
  replaceLocal('customers', jobs.map((j) => ({ id: j.customer_id, first_name: (j as { _first?: string })._first ?? 'X', last_name: 'Roy', phone: '5145550100' })) as never);
  replaceLocal('jobs', jobs as never);
}
/* the server's answer: every stop as it is unless said */
const STOP = (id: string, o: Record<string, unknown> = {}) => ({
  id, truck_id: 'A', truck_before: 'A', block: 'day', order: 1, order_before: 1, eta: 540, eta_before: 540, measured: null, win: [480, 720], new_win: null,
  win_back: false, flex_fixed: false, flex_later: false, late_min: null, early_min: null, pin: null, pin_lost: null, pin_moved: false, ...o
});
const ACCEPT = { windows: {}, flex: {}, late: {}, early: {}, pins: {}, over: {} };
const RAW = (stops: Record<string, unknown>[] = [STOP('a'), STOP('b'), STOP('c'), STOP('d', { truck_id: 'B', truck_before: 'B' })], o: Record<string, unknown> = {}) => ({
  ok: true, day: DAY, basis_ok: true, mode: 'windows', roads: false, rewin: true, auto: false, lists: [], stops,
  trucks: [{ id: 'A', block: 'day', hours_end: 1020, finish: 900, over_min: 0, drive_min: 60, unmeasured: 0 }, { id: 'B', block: 'day', hours_end: 1020, finish: 600, over_min: 0, drive_min: 20, unmeasured: 0 }],
  accept: ACCEPT, due_after: 0, ...o
});
const answer = (raw: unknown) => dayAnswer(raw);
const refusal = (hint: string, details: unknown = null, message = 'Refusé.') => ({ code: 'P0001', hint, message, details: details == null ? null : JSON.stringify(details) });

const box = document.createElement('div');
document.body.appendChild(box);
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const text = (s: string) => q(s)?.textContent ?? '';
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); for (let i = 0; i < 6; i++) await Promise.resolve(); });
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const click = async (s: string | HTMLElement) => { await act(async () => { (typeof s === 'string' ? q(s)! : s).click(); }); await settle(); };
const key = async (s: string, k: string) => { await act(async () => { q(s)!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }); await settle(); };
const byText = (t: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === t);
/** a question's buttons ignore taps for 400 ms after it appears (ui/ask.tsx `hold`): wait, then answer */
const answerAsk = async (o: { ok: true } | { cancel: string }) => { await wait(450); await settle(); await click('ok' in o ? q('ask-ok')! : byText(o.cancel)!); await wait(5); await settle(); };
const closed = vi.fn();
const onSaved = vi.fn();
async function open(at: { day: string; truck?: string; job?: string; first?: boolean } = { day: DAY }) {
  await act(async () => { render(<><DayOrderSheet at={at} onClose={closed} onSaved={onSaved} /><AskHost /><ContextMenuHost /></>, box); });
  await settle();
  await wait(5);
  await settle();
}
/** the keyboard move of a grip: picked up, moved, put down */
async function keyMove(number: number, keys: string[]) {
  await key(`dayorder-grip-${number}`, ' ');
  for (const k of keys) await key(`dayorder-grip-${number}`, k);
  await key(`dayorder-grip-${number}`, 'Enter');
}
const lastAsk = () => h.preview.mock.calls[h.preview.mock.calls.length - 1][0] as { lists: { truck: string; jobs: string[] }[] | null; moved: string[]; auto: boolean; was: Record<string, unknown> };

beforeEach(() => {
  lang.value = 'fr';
  toasts.value = [];
  access.value = owner;
  movesWaiting.value = new Set();
  setNet({ online: true });
  localStorage.clear();
  h.preview.mockReset(); h.save.mockReset(); h.warm.mockClear(); h.pull.mockClear(); h.openTell.mockClear(); closed.mockClear(); onSaved.mockClear();
  h.preview.mockImplementation(async () => answer(RAW()));
  seed();
});
afterEach(async () => { await act(async () => { render(null, box); }); clearAll(); access.value = null; });

describe('opened, nothing changed', () => {
  it('ONE preview of the day as it is (the stored order, nothing moved, the basis); every row shows the server\'s arrival', async () => {
    h.preview.mockImplementation(async () => answer(RAW([STOP('a', { eta: 600 }), STOP('b', { eta: 660 }), STOP('c', { eta: 720 }), STOP('d', { truck_id: 'B' })])));
    await open();
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(lastAsk()).toMatchObject({ lists: [{ truck: 'A', block: 'day', jobs: ['a', 'b', 'c'] }, { truck: 'B', block: 'day', jobs: ['d'] }], moved: [], auto: false });
    expect(Object.keys(lastAsk().was).sort()).toEqual(['a', 'b', 'c', 'd', 'live']);
    expect(text('dayorder-eta-11')).toBe('vers 10 h');
    expect(text('dayorder-hours-11')).toBe('plage 8 h à 12 h');
    expect(text('dayorder-live-10')).toContain('Sur place : Alice Roy');
    // the hint under the sticky band, not in it (the band stays one short line and the chips: review F2)
    expect(text('dayorder-hint')).toContain('Glisse ≡ pour changer l’ordre ou le camion.');
    expect(text('dayorder-status')).not.toContain('Glisse');
    expect(text('dayorder-headline-A')).toBe('4 arrêts, de 10 h à 15 h, 1 h de route');
    expect(q('dayorder-save')!.hasAttribute('disabled')).toBe(true);
    expect(text('dayorder-close')).toBe('Fermer');
    expect(q('dayorder-summary')).toBeNull();
  });
  it('nothing changed: the server\'s times only, no verdict of a save that cannot happen', async () => {
    h.preview.mockImplementation(async () => answer(RAW([STOP('a'), STOP('b', { eta: 790, new_win: [780, 1020], late_min: 10 }), STOP('c'), STOP('d', { truck_id: 'B' })], { accept: { ...ACCEPT, windows: { b: 780 } } })));
    await open();
    expect(text('dayorder-eta-12')).toBe('vers 13 h 10');
    expect(q('dayorder-pill-12')).toBeNull();
    expect(q('dayorder-note-12')).toBeNull();
    expect(text('dayorder-hours-12')).toBe('plage 8 h à 12 h');
  });
  it('a client who does not have his hours: the footer\'s primary is « Envoyer les heures aux clients (N) »', async () => {
    seed([...world().slice(0, 4), J('d', 21, 'Omar', 1, { truck_id: 'B', told_at: null, told_day: null, told_start: null, told_end: null })]);
    await open();
    expect(text('dayorder-send')).toBe('Envoyer les heures aux clients (1)');
    await click('dayorder-send');
    expect(h.openTell).toHaveBeenCalledWith(DAY);
  });
  it('switch « Vraies routes » on, the owner: the day\'s trips measured first, then the preview', async () => {
    seed(world(), { roads_on: true });
    let done!: () => void;
    h.warm.mockImplementationOnce(() => new Promise((r) => { done = () => r({ ok: true, ready: true }); }));
    await open();
    expect(h.warm).toHaveBeenCalledWith(null, DAY, 1);
    expect(text('dayorder-measuring')).toContain('Mesure des routes de la journée…');
    expect(h.preview).not.toHaveBeenCalled();
    await act(async () => { done(); });
    await settle(); await wait(5); await settle();
    expect(q('dayorder-measuring')).toBeNull();
    expect(h.preview).toHaveBeenCalledTimes(1);
  });
});

describe('moving a stop (keyboard, the row menu, a mouse)', () => {
  it('the keyboard: Space picks it up, ↑ one place, Enter puts it down; the preview 600 ms after with every list and moved', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    expect(text('dayorder-live')).toBe('Denis Roy : arrêt 3 sur 4, Camion Complet.');
    expect(text('dayorder-unsaved')).toBe('Pas enregistré');
    await wait(60); await settle();
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(lastAsk()).toMatchObject({ lists: [{ truck: 'A', jobs: ['a', 'c', 'b'] }, { truck: 'B', jobs: ['d'] }], moved: ['c'] });
  });
  it('Escape puts it back, the sheet stays open', async () => {
    await open();
    await key('dayorder-grip-13', ' ');
    await key('dayorder-grip-13', 'ArrowUp');
    await key('dayorder-grip-13', 'Escape');
    expect(q('dayorder-sheet')).toBeTruthy();
    expect(closed).not.toHaveBeenCalled();
    expect(q('dayorder-unsaved')).toBeNull();
  });
  it('the row menu: « Mettre en premier », « Monter »; « Mettre sur Voiture » asks first (the other kind); tire work greyed', async () => {
    seed([...world().slice(0, 3), J('c', 13, 'Denis', 4, { needs_machine: true } as Partial<Job>), world()[4]]);
    await open();
    await click('dayorder-main-12');
    expect(q('dayorder-menu')).toBeTruthy();
    expect(q('dayorder-menu-on-B')).toBeTruthy();
    await click('dayorder-menu-first');
    await wait(5); await settle();
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['b', 'a', 'c']);
    // tire work: « Mettre sur Voiture » greyed with its reason
    await click('dayorder-main-13');
    expect(q('dayorder-menu-on-B')!.hasAttribute('disabled')).toBe(true);
    expect(text('dayorder-menu-on-B')).toContain('ce travail demande le camion');
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await settle(); await wait(5); await settle();
    // onto the car: « Benoit ira avec la voiture : l'app ne le remettra plus sur le camion. »
    await click('dayorder-main-11');
    await click('dayorder-menu-on-B');
    await wait(5); await settle();
    expect(document.body.textContent).toContain('Benoit ira avec la voiture : l’app ne le remettra plus sur le camion.');
    await answerAsk({ ok: true });
    expect([...document.querySelectorAll('[data-dayord-truck="B"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['d', 'a']);
  });
  it('dragged over the chip of a truck it may not go on (tire work, the car): the chip in warn, the reason on the band\'s status line — never the look of a valid place (review F3); Escape on a stop picked and moved to the other truck keeps its grip focused (review F9)', async () => {
    seed([...world().slice(0, 3), J('c', 13, 'Denis', 4, { needs_machine: true } as Partial<Job>), world()[4]]);
    await open();
    const grip = q('dayorder-grip-13')!;
    grip.setPointerCapture = () => undefined;
    const chip = q('dayorder-chip-B')!;
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => chip;
    const pe = (type: string, y: number) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: 10, clientY: y, pointerId: 9, pointerType: 'touch', button: 0 }); return e; };
    await act(async () => { grip.dispatchEvent(pe('pointerdown', 400)); });
    await act(async () => { window.dispatchEvent(pe('pointermove', 60)); });
    expect(q('dayorder-chip-B')!.className).toContain('is-refused');
    expect(q('dayorder-chip-B')!.className).not.toContain('is-over');
    expect(text('dayorder-band-refused')).toContain('ce travail demande le camion');
    await act(async () => { window.dispatchEvent(pe('pointerup', 60)); });
    await settle();
    expect(q('dayorder-band-refused')).toBeNull();
    (document as { elementFromPoint?: unknown }).elementFromPoint = undefined;
    // the keyboard: Benoit picked, → onto the Voiture, Escape: back on the Camion, his grip still focused
    await key('dayorder-grip-11', ' ');
    await key('dayorder-grip-11', 'ArrowRight');
    expect(q('dayorder-grip-11')!.closest('[data-dayord-truck]')!.getAttribute('data-dayord-truck')).toBe('B');
    await key('dayorder-grip-11', 'Escape');
    await settle();
    expect(q('dayorder-grip-11')!.closest('[data-dayord-truck]')!.getAttribute('data-dayord-truck')).toBe('A');
    expect(document.activeElement).toBe(q('dayorder-grip-11'));
  });
  it('a mouse drags the whole row onto another place; a long press on a row opens NO appointment menu', async () => {
    await open();
    const main = q('dayorder-main-11')!;
    const target = q('dayorder-main-13')!;
    q('dayorder-row-13')!.getBoundingClientRect = () => ({ top: 400, bottom: 464, height: 64, left: 0, right: 300, width: 300, x: 0, y: 400, toJSON: () => ({}) }) as DOMRect;
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => target;
    const pe = (type: string, y: number) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientX: 10, clientY: y, pointerId: 7, pointerType: 'mouse', button: 0 }); return e; };
    await act(async () => { main.dispatchEvent(pe('pointerdown', 300)); });
    await act(async () => { window.dispatchEvent(pe('pointermove', 450)); });
    expect(q('dayorder-row-11')!.className).toContain('is-dragging');
    expect(document.querySelector('.dayord-ghost')!.parentElement).toBe(document.body);
    await act(async () => { window.dispatchEvent(pe('pointerup', 450)); });
    await settle();
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['b', 'c', 'a']);
    // a finger held 600 ms on a row: no shortcut menu (the rows spread none)
    const f = new Event('pointerdown', { bubbles: true }); Object.assign(f, { clientX: 10, clientY: 300, pointerId: 8, pointerType: 'touch', button: 0 });
    await act(async () => { q('dayorder-main-12')!.dispatchEvent(f); });
    await wait(650);
    q('dayorder-main-12')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    expect(q('agenda-menu')).toBeNull();
    (document as { elementFromPoint?: unknown }).elementFromPoint = undefined;
  });
});

describe('what the server says (§2.5)', () => {
  async function moveAndAnswer(raw: unknown) {
    await open();
    h.preview.mockImplementation(async () => answer(raw));
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
  }
  it('someone changes hour: « Nouvelle plage », « 9 h à 13 h devient 13 h à 17 h », the summary, « Enregistrer quand même »', async () => {
    await moveAndAnswer(RAW([STOP('a'), STOP('c'), STOP('b', { eta: 790, new_win: [780, 1020] }), STOP('d', { truck_id: 'B' })], { accept: { ...ACCEPT, windows: { b: 780 } } }));
    expect(text('dayorder-pill-12')).toBe('Nouvelle plage');
    expect(text('dayorder-hours-12')).toBe('8 h à 12 h devient 13 h à 17 h');
    expect(text('dayorder-summary')).toBe('1 client changera d’heure : Chloe. Rien ne lui est envoyé maintenant.');
    expect(text('dayorder-save')).toBe('Enregistrer quand même');
  });
  it('told already today: « déjà averti aujourd\'hui : un 2e texto partira » (days F16)', async () => {
    seed([...world().slice(0, 2), J('b', 12, 'Chloe', 3, { told_at: new Date().toISOString() }), ...world().slice(3)]);
    await moveAndAnswer(RAW([STOP('a'), STOP('c'), STOP('b', { eta: 790, new_win: [780, 1020] }), STOP('d', { truck_id: 'B' })], { accept: { ...ACCEPT, windows: { b: 780 } } }));
    expect(text('dayorder-row-12')).toContain('déjà averti aujourd’hui : un 2e texto partira');
  });
  it('back to what he was told (win_back): said in the ok tone, not a warning: « Enregistrer »', async () => {
    await moveAndAnswer(RAW([STOP('a'), STOP('c', { win: [780, 1020], new_win: [480, 720], win_back: true }), STOP('b'), STOP('d', { truck_id: 'B' })]));
    expect(text('dayorder-note-13')).toBe('13 h à 17 h revient à 8 h à 12 h : l’heure qu’il a eue');
    expect(text('dayorder-summary')).toBe('Personne ne change d’heure.');
    expect(text('dayorder-save')).toBe('Enregistrer');
  });
  it('flexible: given its window at the save (flex_fixed) / a later day (flex_later); planned ≠ told « dit : … »; another day told', async () => {
    seed([
      J('a', 11, 'Benoit', 2, { win_start: null, win_end: null, win_flex: true, told_start: null, told_end: null }),
      J('b', 12, 'Chloe', 3, { win_start: null, win_end: null, win_flex: true, told_start: null, told_end: null }),
      J('c', 13, 'Denis', 4, { win_start: 840, win_end: 1080, told_start: 540, told_end: 780 }),
      J('e', 14, 'Émile', 5, { told_day: addDays(DAY, -1) }),
      world()[4]
    ]);
    await moveAndAnswer(RAW([STOP('a', { win: null, new_win: [540, 780], flex_fixed: true }), STOP('c', { win: [840, 1080] }), STOP('b', { win: null, flex_later: true }), STOP('e'), STOP('d', { truck_id: 'B' })], { accept: { ...ACCEPT, flex: { a: 540 } } }));
    expect(text('dayorder-hours-11')).toBe('Dans la journée : recevra 9 h à 13 h');
    expect(text('dayorder-hours-12')).toBe('Dans la journée (sa plage se fixe la veille à 18 h)');
    expect(text('dayorder-hours-13')).toBe('plage 14 h à 18 h, dit : 9 h à 13 h');
    expect(text('dayorder-hours-14')).toMatch(/^plage 8 h à 12 h, dit : /);
    expect(text('dayorder-save')).toBe('Enregistrer');                                // a flex window is not a warning
  });
  it('late / early (a mechanic\'s save, the switch « plages fixes »): the rows and the summary, never « Nouvelle plage »', async () => {
    access.value = mechanic;
    await moveAndAnswer(RAW([STOP('a', { early_min: 20 }), STOP('c'), STOP('b', { late_min: 25 })], { rewin: false, accept: { ...ACCEPT, late: { b: 25 }, early: { a: 20 } } }));
    expect(text('dayorder-note-12')).toBe('Arriverait 25 min après sa plage');
    expect(text('dayorder-note-11')).toBe('Arriverait 20 min avant sa plage');
    expect(q('dayorder-pill-12')).toBeNull();
    expect(text('dayorder-summary')).toContain('1 client serait en retard : Chloe. Appelle-le ou change l’ordre.');
    expect(text('dayorder-summary')).toContain('1 client arriverait avant sa plage : Benoit. Appelle-le ou change l’ordre.');
    expect(text('dayorder-save')).toBe('Enregistrer quand même');
  });
  it('a pinned minute: kept, lost (not moved), gone with the drag (pin_moved); a truck past its hours', async () => {
    seed([J('a', 11, 'Benoit', 2, { arrive_at: 630 }), J('b', 12, 'Chloe', 3, { arrive_at: 840 }), J('c', 13, 'Denis', 4, { arrive_at: 600 }), world()[4]]);
    await moveAndAnswer(RAW([STOP('a', { pin_lost: 630, eta: 655 }), STOP('c', { pin_lost: 600, pin_moved: true }), STOP('b', { pin: 840 })],
      { trucks: [{ id: 'A', block: 'day', hours_end: 1020, finish: 1060, over_min: 40, drive_min: 60, unmeasured: 0 }], accept: { ...ACCEPT, pins: { a: 630, c: 600 }, over: { A: 40 } } }));
    expect(text('dayorder-note-11')).toBe('L’heure fixée (10 h 30) ne tient plus : vers 10 h 55');
    expect(text('dayorder-note-13')).toBe('L’heure fixée (10 h) part : tu l’as déplacé');
    expect(text('dayorder-note-12')).toBe('Heure fixée 14 h');
    expect(text('dayorder-over-A')).toBe('finit à 17 h 40, après ses heures (17 h)');
    expect(text('dayorder-summary')).toContain('2 heures fixées ne tiennent plus : Benoit, Denis.');
    expect(text('dayorder-summary')).toContain('1 camion finirait après ses heures.');
  });
  it('not measured: « heure : trajets pas encore mesurés », the truck\'s note, never late', async () => {
    seed(world(), { roads_on: true });
    await moveAndAnswer(RAW([STOP('a'), STOP('c', { measured: false }), STOP('b', { measured: true })],
      { roads: true, trucks: [{ id: 'A', block: 'day', hours_end: 1020, finish: 900, over_min: 0, drive_min: 60, unmeasured: 1 }] }));
    expect(text('dayorder-eta-13')).toBe('heure : trajets pas encore mesurés');
    expect(text('dayorder-unmeasured-A')).toBe('Routes de cette journée pas toutes mesurées : ces heures viendront plus tard.');
    expect(text('dayorder-summary')).toContain('1 arrêt sans heure mesurée');
  });
  it('refused by the preview (truck_ends): its words with the names, the row marked, « Enregistrer » off until the draft changes', async () => {
    await open();
    h.preview.mockImplementation(async () => { throw refusal('truck_ends', { truck: 'B', ends: 720, jobs: ['c'] }); });
    await click('dayorder-main-13');
    await click('dayorder-menu-on-B');
    await wait(5); await settle();
    await answerAsk({ ok: true });
    await wait(60); await settle();
    expect(text('dayorder-summary')).toBe('Voiture finit à 12 h ce jour-là : Denis n’y entre pas.');
    expect(q('dayorder-row-13')!.className).toContain('is-warn');
    expect(q('dayorder-save')!.hasAttribute('disabled')).toBe(true);
    h.preview.mockImplementation(async () => answer(RAW()));
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    expect(q('dayorder-save')!.hasAttribute('disabled')).toBe(false);
  });
  it('no answer in 6 s: « Heures d\'arrivée : pas encore calculées. » + « Réessayer »; « Enregistrer » still works', async () => {
    await open();
    h.preview.mockImplementation(() => new Promise(() => undefined));
    await keyMove(13, ['ArrowUp']);
    await wait(60);
    expect(text('dayorder-eta-13')).toBe('calcul…');
    expect(text('dayorder-summary')).toBe('Calcul des heures…');
    await wait(320); await settle();
    expect(text('dayorder-summary')).toContain('Heures d’arrivée : pas encore calculées.');
    expect(q('dayorder-retry')).toBeTruthy();
    expect(q('dayorder-save')!.hasAttribute('disabled')).toBe(false);
  });
  it('a preview that gave up on a lock (55P03) is asked once more, 600 ms later', async () => {
    await open();
    let n = 0;
    h.preview.mockImplementation(async () => { if (n++ === 0) throw { code: '55P03', message: 'lock timeout' }; return answer(RAW([STOP('a'), STOP('c', { eta: 600 }), STOP('b')])); });
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    await wait(60); await settle();
    expect(n).toBe(2);
    expect(text('dayorder-eta-13')).toBe('vers 10 h');
  });
});

describe('« Enregistrer » (§2.6)', () => {
  const SAVED = (o: Record<string, unknown> = {}) => answer({ ...RAW(), saved: true, ...o });
  it('nothing to accept: one tap saves with the preview\'s accept; the toast; the sheet stays on the saved day', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    h.save.mockImplementation(async () => SAVED());
    await click('dayorder-save');
    expect(h.save).toHaveBeenCalledTimes(1);
    const [ask, accept, op] = h.save.mock.calls[0];
    expect(ask).toMatchObject({ day: DAY, moved: ['c'], auto: false, lists: [{ truck: 'A', jobs: ['a', 'c', 'b'] }, { truck: 'B', jobs: ['d'] }] });
    expect(accept).toEqual(ACCEPT);
    expect(typeof op).toBe('string');
    expect(toasts.value.map((x) => x.text)).toContain('Journée enregistrée. Aucun texto n’est parti.');
    expect(onSaved).toHaveBeenCalled();
    expect(q('dayorder-sheet')).toBeTruthy();
    expect(localStorage.getItem(`his.dayOrder.u-hassan.${DAY}`)).toBeNull();
  });
  it('a verdict to accept: shown first (one more tap); then sent with exactly that accept', async () => {
    await open();
    const raw = RAW([STOP('a'), STOP('c'), STOP('b', { new_win: [780, 1020] })], { accept: { ...ACCEPT, windows: { b: 780 } } });
    h.preview.mockImplementation(async () => answer(raw));
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    h.save.mockImplementation(async () => SAVED());
    expect(text('dayorder-save')).toBe('Enregistrer quand même');
    await click('dayorder-save');
    expect(h.save.mock.calls[0][1]).toEqual(raw.accept);
  });
  it('the preview not for this draft: asked first (« Vérification… »); a verdict then is SHOWN, nothing written', async () => {
    await open();
    h.preview.mockImplementation(() => new Promise(() => undefined));
    await keyMove(13, ['ArrowUp']);
    await wait(400); await settle();
    h.preview.mockImplementation(async () => answer(RAW([STOP('a'), STOP('c'), STOP('b', { new_win: [780, 1020] })], { accept: { ...ACCEPT, windows: { b: 780 } } })));
    await click('dayorder-save');
    await settle();
    expect(h.save).not.toHaveBeenCalled();
    expect(text('dayorder-save')).toBe('Enregistrer quand même');
  });
  it('a deadlock (40P01): once more after 1 s with the SAME op', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    let n = 0;
    h.save.mockImplementation(async () => { if (n++ === 0) throw { code: '40P01', message: 'deadlock detected' }; return SAVED(); });
    await click('dayorder-save');
    await wait(60); await settle();
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[0][2]).toBe(h.save.mock.calls[1][2]);
    expect(toasts.value.map((x) => x.text)).toContain('Journée enregistrée. Aucun texto n’est parti.');
  });
  it('twice a deadlock: « Le serveur est occupé : réessaie dans un instant. »', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    h.save.mockImplementation(async () => { throw { code: '40P01', message: 'deadlock detected' }; });
    await click('dayorder-save');
    await wait(60); await settle();
    expect(text('dayorder-summary')).toBe('Le serveur est occupé : réessaie dans un instant.');
  });
  it('the answer lost: « … Je vérifie… », the SAME call with the SAME op once more (days F20); lost again: « Pas enregistré. Réessaie. »', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    let release!: () => void;
    let n = 0;
    h.save.mockImplementation(() => (n++ === 0 ? Promise.reject({ name: 'TimeoutError', message: 'timeout' }) : new Promise((_r, no) => { release = () => no({ name: 'TimeoutError', message: 'timeout' }); })));
    await click('dayorder-save');
    expect(text('dayorder-summary')).toBe('Pas de réponse du serveur : la journée est peut-être enregistrée. Je vérifie…');
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[0][2]).toBe(h.save.mock.calls[1][2]);
    expect(h.save.mock.calls[0][0]).toEqual(h.save.mock.calls[1][0]);
    await act(async () => { release(); });
    await settle();
    expect(text('dayorder-summary')).toBe('Pas enregistré. Réessaie.');
  });
  it('outcome_changed: its detail redraws everything at once (no other call), the button as it now says', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    const calls = h.preview.mock.calls.length;
    h.save.mockImplementation(async () => { throw refusal('outcome_changed', RAW([STOP('a'), STOP('c'), STOP('b', { new_win: [780, 1020] })], { accept: { ...ACCEPT, windows: { b: 780 } } })); });
    await click('dayorder-save');
    expect(text('dayorder-outcome')).toBe('Les heures ont changé depuis la vérification : regarde, puis enregistre de nouveau.');
    expect(text('dayorder-pill-12')).toBe('Nouvelle plage');
    expect(text('dayorder-save')).toBe('Enregistrer quand même');
    await wait(60); await settle();
    expect(h.preview.mock.calls.length).toBe(calls);
  });
  it('offline: the Banner, « Enregistrer » off, nothing asked; a move of that day waiting on the phone: « Enregistrer » waits', async () => {
    setNet({ online: false });
    await open();
    expect(text('dayorder-offline')).toBe('Pas de réseau : tu peux préparer l’ordre, mais les heures et « Enregistrer » attendent le réseau.');
    await keyMove(13, ['ArrowUp']);
    await wait(60); await settle();
    expect(h.preview).not.toHaveBeenCalled();
    expect(q('dayorder-save')!.hasAttribute('disabled')).toBe(true);
    setNet({ online: true });
    await act(async () => { movesWaiting.value = new Set(['a']); });
    await settle();
    expect(text('dayorder-waitmove')).toContain('Un déplacement de cette journée attend d’être envoyé');
    expect(text('dayorder-row-11')).toContain('En attente d’envoi');
    expect(q('dayorder-grip-11')).toBeNull();
    expect(q('dayorder-save')!.hasAttribute('disabled')).toBe(true);
  });
});

describe('someone else changed the day (§2.7), the draft kept on the phone', () => {
  it('another person saved: asked with the OLD basis to learn who, the jobs pulled, his order taken, this move kept', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);                                                // a, c, b
    await wait(60); await settle();
    h.preview.mockImplementation(async () => answer({ ok: true, basis_ok: false, gone: [], new: [], changed: ['a', 'b'], by: { name: 'Ibrahim' } }));
    // his save: b first, then a
    await act(async () => { upsertLocal('jobs', [{ ...world()[2], stop_order: 1, updated_at: '2030-01-01T00:00:00Z' }, { ...world()[1], stop_order: 2, updated_at: '2030-01-01T00:00:00Z' }] as never); });
    await settle(); await wait(10); await settle();
    expect(h.pull).toHaveBeenCalledWith('jobs');
    expect(text('dayorder-changed')).toBe('Ibrahim vient d’enregistrer cette journée : son ordre est repris ; ton arrêt déplacé est gardé.');
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['b', 'a', 'c']);
  });
  it('« Je pars », a new booking: « La journée vient de changer : Benoit commencé, Zoé ajouté. … »', async () => {
    await open();
    await act(async () => { upsertLocal('jobs', [{ ...world()[1], status: 'en_route', updated_at: '2030-01-01T00:00:00Z' }, J('z', 15, 'Zoé', 6)] as never); });
    await act(async () => { upsertLocal('customers', [{ id: 'c-z', first_name: 'Zoé', last_name: 'Roy' }] as never); });
    await settle(); await wait(10); await settle();
    expect(text('dayorder-changed')).toBe('La journée vient de changer : Benoit commencé, Zoé ajouté. Tes arrêts déplacés sont gardés : vérifie, puis enregistre.');
    expect(text('dayorder-live-11')).toContain('En route : Benoit Roy');
    expect(text('dayorder-row-15')).toContain('Nouveau');
  });
  it('the draft kept on the phone comes back (« Ton ordre pas encore enregistré (…) est revenu »); « Oublier ce brouillon »', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    expect(localStorage.getItem(`his.dayOrder.u-hassan.${DAY}`)).toBeTruthy();
    await act(async () => { render(null, box); });
    await open();
    expect(text('dayorder-draft-back')).toMatch(/Ton ordre pas encore enregistré \(\d+ h( \d\d)?\) est revenu : vérifie, puis enregistre\./);
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['a', 'c', 'b']);
    await click('dayorder-forget');
    expect(localStorage.getItem(`his.dayOrder.u-hassan.${DAY}`)).toBeNull();
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['a', 'b', 'c']);
  });
  it('« Annuler » with changes: « Quitter sans enregistrer ? » — « Rester » keeps it, « Quitter » drops the draft', async () => {
    await open();
    await keyMove(13, ['ArrowUp']);
    await click('dayorder-cancel');
    expect(document.body.textContent).toContain('Quitter sans enregistrer ?');
    await answerAsk({ cancel: 'Rester' });
    expect(closed).not.toHaveBeenCalled();
    await click('dayorder-cancel');
    await answerAsk({ ok: true });
    await wait(800); await settle();
    expect(closed).toHaveBeenCalled();
    expect(localStorage.getItem(`his.dayOrder.u-hassan.${DAY}`)).toBeNull();
  });
});

describe('« Laisser l\'app choisir », and who sees what', () => {
  it('asked first; the planner\'s lists become the draft (auto), « Remettre comme avant » gives the order back', async () => {
    await open();
    h.preview.mockImplementation(async (a: { lists: unknown }) => answer({ ...RAW(), auto: a.lists === null, lists: [{ truck: 'A', block: 'day', jobs: ['c', 'b', 'a'] }, { truck: 'B', block: 'day', jobs: ['d'] }] }));
    await click('dayorder-auto');
    expect(document.body.textContent).toContain('Laisser l’app refaire toute la journée ?');
    await answerAsk({ ok: true });
    await wait(10); await settle();
    expect(lastAsk()).toMatchObject({ lists: null, moved: [], auto: true });
    expect(text('dayorder-auto-shown')).toBe('Voici l’ordre de l’app. Rien n’est enregistré.');
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['c', 'b', 'a']);
    h.save.mockImplementation(async () => answer({ ...RAW(), saved: true }));
    await click('dayorder-auto-back');
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['a', 'b', 'c']);
  });
  it('a mechanic: his truck only, no « Laisser l\'app choisir », no « Mettre sur … », no send button', async () => {
    access.value = mechanic;
    seed([...world().slice(0, 4), J('d', 21, 'Omar', 1, { truck_id: 'B', told_at: null })]);
    await open();
    expect(q('dayorder-truck-A')).toBeTruthy();
    expect(q('dayorder-truck-B')).toBeNull();
    expect(q('dayorder-auto')).toBeNull();
    expect(q('dayorder-send')).toBeNull();
    await click('dayorder-main-12');
    expect(q('dayorder-menu-up')).toBeTruthy();
    expect(document.querySelector('[data-testid^="dayorder-menu-on-"]')).toBeNull();
  });
  it('opened from a job with « Mettre en premier »: that stop first in the draft (moved, not saved), ringed', async () => {
    await open({ day: DAY, truck: 'A', job: 'c', first: true });
    expect([...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['c', 'a', 'b']);
    expect(q('dayorder-row-13')!.className).toContain('is-this');
    expect(text('dayorder-unsaved')).toBe('Pas enregistré');
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe('Part 29: the stop dragged takes the hour of its new place and keeps it; the others keep theirs (drag-keeps-spec.md §5)', () => {
  // the day as it is: Benoit 10 h, Chloe 11 h, Denis 12 h (the stored arrivals), each 8 h – 12 h
  const NOW = () => RAW([STOP('a', { eta: 600, eta_before: 600 }), STOP('b', { eta: 660, eta_before: 660 }), STOP('c', { eta: 720, eta_before: 720 }), STOP('d', { truck_id: 'B', truck_before: 'B', eta: 540, eta_before: 540 })]);
  const notes = (n: number) => [...document.querySelectorAll(`[data-testid="dayorder-note-${n}"]`)].map((x) => x.textContent);
  const order = () => [...document.querySelectorAll('[data-dayord-truck="A"] [data-dayord-row]')].map((r) => (r as HTMLElement).dataset.id);
  async function openNow() {
    h.preview.mockImplementation(async () => answer(NOW()));
    await open();
  }
  /** Benoit dragged DOWN to the end (after Denis): the server's answer for that order */
  async function benoitDown(raw: unknown) {
    await openNow();
    h.preview.mockImplementation(async () => answer(raw));
    await keyMove(11, ['ArrowDown', 'ArrowDown']);
    await wait(60); await settle();
  }
  const DOWN = (o: { win?: [number, number] | null; accept?: Record<string, unknown> } = {}) => RAW([
    STOP('b', { eta: 660, eta_before: 660 }), STOP('c', { eta: 720, eta_before: 720 }),
    STOP('a', { eta: 800, eta_before: 600, pin: 800, pin_new: true, pin_was: null, new_win: o.win === undefined ? [720, 960] : o.win }),
    STOP('d', { truck_id: 'B', truck_before: 'B', eta: 540, eta_before: 540 })
  ], { accept: o.accept ?? { ...ACCEPT, windows: { a: 720 }, at: { a: 800 } } });

  it('dragged DOWN: its row says its new hour « fixé à 13 h 20 » and its hour before; the others keep their hour (no note); the summary says it; its new window as before', async () => {
    await benoitDown(DOWN());
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(text('dayorder-eta-11')).toBe('fixé à 13 h 20');
    expect(notes(11)).toEqual(['avant : vers 10 h']);
    expect(text('dayorder-pill-11')).toBe('Nouvelle plage');
    expect(text('dayorder-hours-11')).toBe('8 h à 12 h devient 12 h à 16 h');
    expect([text('dayorder-eta-12'), text('dayorder-eta-13')]).toEqual(['vers 11 h', 'vers 12 h']);
    expect([notes(12), notes(13)]).toEqual([[], []]);
    expect(text('dayorder-summary')).toBe('Benoit à 13 h 20 : fixé là où tu l’as mis. Les autres gardent leur heure. 1 client changera d’heure : Benoit. Rien ne lui est envoyé maintenant.');
    expect(text('dayorder-save')).toBe('Enregistrer quand même');
    h.save.mockImplementation(async () => answer({ ...DOWN(), saved: true }));
    await click('dayorder-save');
    expect(h.save.mock.calls[0][1]).toEqual({ ...ACCEPT, windows: { a: 720 }, at: { a: 800 } });
  });
  it('its window holds its new hour (D1): no « Nouvelle plage »; the minute pinned is no warning: ONE tap on « Enregistrer » saves, accept.at sent back as the preview gave it', async () => {
    await benoitDown(RAW([
      STOP('b', { eta: 600, eta_before: 660 }), STOP('a', { eta: 700, eta_before: 600, pin: 700, pin_new: true }), STOP('c', { eta: 720, eta_before: 720 }), STOP('d', { truck_id: 'B', truck_before: 'B', eta: 540, eta_before: 540 })
    ], { accept: { ...ACCEPT, at: { a: 700 } } }));
    expect(text('dayorder-eta-11')).toBe('fixé à 11 h 40');
    expect(q('dayorder-pill-11')).toBeNull();
    expect(text('dayorder-hours-11')).toBe('plage 8 h à 12 h');
    expect(text('dayorder-summary')).toBe('Benoit à 11 h 40 : fixé là où tu l’as mis.');                // Chloe's hour changed (an older rule): « les autres gardent » is not said
    expect(text('dayorder-save')).toBe('Enregistrer');
    h.save.mockImplementation(async () => answer({ ...RAW(), saved: true }));
    await click('dayorder-save');
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][1]).toEqual({ ...ACCEPT, at: { a: 700 } });
  });
  it('while the server is asked: only the stop dragged says « calcul… »; every other stop keeps showing its hour', async () => {
    await openNow();
    h.preview.mockImplementation(() => new Promise(() => undefined));
    await keyMove(11, ['ArrowDown', 'ArrowDown']);
    await wait(60);
    expect(text('dayorder-eta-11')).toBe('calcul…');
    expect([text('dayorder-eta-12'), text('dayorder-eta-13')]).toEqual(['vers 11 h', 'vers 12 h']);
    expect(text('dayorder-headline-A')).toBe('calcul…');
  });
  it('a drag that truly takes the others\' time: the one pushed inside its window says its hour before and is named; one pushed out gets its new window as before', async () => {
    await openNow();
    h.preview.mockImplementation(async () => answer(RAW([
      STOP('c', { eta: 600, eta_before: 720, pin: 600, pin_new: true }), STOP('a', { eta: 680, eta_before: 600 }),
      STOP('b', { eta: 760, eta_before: 660, new_win: [720, 960] }), STOP('d', { truck_id: 'B', truck_before: 'B', eta: 540, eta_before: 540 })
    ], { accept: { ...ACCEPT, windows: { b: 720 }, at: { c: 600 } } })));
    await keyMove(13, ['ArrowUp', 'ArrowUp']);
    await wait(60); await settle();
    expect(order()).toEqual(['c', 'a', 'b']);
    expect(text('dayorder-eta-13')).toBe('fixé à 10 h');
    expect(text('dayorder-eta-11')).toBe('vers 11 h 20');
    expect(notes(11)).toEqual(['avant : vers 10 h']);
    expect(text('dayorder-pill-12')).toBe('Nouvelle plage');
    expect(notes(12)).toEqual(['avant : vers 11 h']);
    expect(text('dayorder-summary')).toBe('Denis à 10 h : fixé là où tu l’as mis. 1 arrêt passe plus tard dans sa plage : Benoit. 1 client changera d’heure : Chloe. Rien ne lui est envoyé maintenant.');
  });
  it('a stop dragged that had a pinned minute: its new minute replaces it (no « part : tu l\'as déplacé »); a late pin pinned again at its arrival (D2) says so', async () => {
    seed([J('a', 11, 'Benoit', 2, { arrive_at: 590 }), J('b', 12, 'Chloe', 3, { arrive_at: 650 }), J('c', 13, 'Denis', 4), world()[4]]);
    await benoitDown(RAW([
      STOP('b', { eta: 668, eta_before: 668, pin: 668, pin_was: 650 }), STOP('c', { eta: 720, eta_before: 720 }),
      STOP('a', { eta: 800, eta_before: 600, pin: 800, pin_new: true, pin_was: 590, new_win: [720, 960] }), STOP('d', { truck_id: 'B', truck_before: 'B' })
    ], { accept: { ...ACCEPT, windows: { a: 720 }, at: { a: 800, b: 668 } } }));
    expect(text('dayorder-eta-11')).toBe('fixé à 13 h 20');
    expect(notes(11)).toEqual(['avant : vers 10 h']);
    expect(notes(12)).toEqual(['Heure fixée 10 h 50 → 11 h 08 : il arrivait déjà à cette heure']);
    expect(text('dayorder-summary')).not.toContain('heure fixée ne tient plus');
  });
  it('nothing changed: a late pin the save WOULD pin again still shows the pin it has (nothing is saved)', async () => {
    seed([J('a', 11, 'Benoit', 2, { arrive_at: 590 }), J('b', 12, 'Chloe', 3), J('c', 13, 'Denis', 4), world()[4]]);
    h.preview.mockImplementation(async () => answer(RAW([STOP('a', { eta: 600, eta_before: 600, pin: 600, pin_was: 590 }), STOP('b'), STOP('c'), STOP('d', { truck_id: 'B', truck_before: 'B' })], { accept: { ...ACCEPT, at: { a: 600 } } })));
    await open();
    expect(notes(11)).toEqual(['Heure fixée 9 h 50']);
  });
  it('a « new window » equal to the one it has (F4: an arrival past the day\'s end) is no new window: no pill, not counted, no « Enregistrer quand même » for it', async () => {
    await benoitDown(DOWN({ win: [480, 720], accept: { ...ACCEPT, windows: { a: 480 }, at: { a: 800 } } }));
    expect(q('dayorder-pill-11')).toBeNull();
    expect(text('dayorder-hours-11')).toBe('plage 8 h à 12 h');
    expect(text('dayorder-summary')).toBe('Benoit à 13 h 20 : fixé là où tu l’as mis. Les autres gardent leur heure.');
    expect(text('dayorder-save')).toBe('Enregistrer');
  });
  it('after « Enregistrer » the list is exactly his order, the stop dragged « Heure fixée » at its minute', async () => {
    await benoitDown(DOWN({ win: null, accept: { ...ACCEPT, at: { a: 800 } } }));
    const AFTER = RAW([STOP('b', { eta: 660, eta_before: 660 }), STOP('c', { eta: 720, eta_before: 720 }), STOP('a', { eta: 800, eta_before: 800, pin: 800 }), STOP('d', { truck_id: 'B', truck_before: 'B', eta: 540, eta_before: 540 })]);
    h.save.mockImplementation(async () => {
      // the save's rows land on the phone (src/data/dayOrder.ts: the answer's rows applied)
      upsertLocal('jobs', [{ ...world()[2], stop_order: 2, updated_at: '2030-01-01T00:00:00Z' }, { ...world()[3], stop_order: 3, updated_at: '2030-01-01T00:00:00Z' },
        { ...world()[1], stop_order: 4, eta_min: 800, arrive_at: 800, truck_pinned: true, updated_at: '2030-01-01T00:00:00Z' }] as never);
      return answer({ ...AFTER, saved: true });
    });
    h.preview.mockImplementation(async () => answer(AFTER));
    await click('dayorder-save');
    await wait(10); await settle();
    expect(order()).toEqual(['b', 'c', 'a']);
    expect(q('dayorder-unsaved')).toBeNull();
    expect(text('dayorder-eta-11')).toBe('vers 13 h 20');
    expect(notes(11)).toEqual(['Heure fixée 13 h 20']);
    expect([text('dayorder-eta-12'), text('dayorder-eta-13')]).toEqual(['vers 11 h', 'vers 12 h']);
  });
  it('in English: « set at … », « was around … », the summary', async () => {
    lang.value = 'en';
    await benoitDown(DOWN({ win: null, accept: { ...ACCEPT, at: { a: 800 } } }));
    expect(text('dayorder-eta-11')).toBe(`set at ${clock(800, 'en')}`);
    expect(notes(11)).toEqual([`was around ${clock(600, 'en')}`]);
    expect(text('dayorder-summary')).toBe(`Benoit at ${clock(800, 'en')}: set where you put it. The others keep their time.`);
  });
  it('an older server (no pin_new): the rows read as before (« vers … »), the summary says nobody changes when nobody does', async () => {
    await benoitDown(RAW([STOP('b', { eta: 660, eta_before: 660 }), STOP('c', { eta: 720, eta_before: 720 }), STOP('a', { eta: 800, eta_before: 600 }), STOP('d', { truck_id: 'B', truck_before: 'B', eta: 540, eta_before: 540 })]));
    expect(text('dayorder-eta-11')).toBe('vers 13 h 20');
    expect(notes(11)).toEqual(['avant : vers 10 h']);
    expect(text('dayorder-summary')).toBe('Personne ne change d’heure.');
  });
});

