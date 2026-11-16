/* « Réserver en ligne » with « Plages d’arrivée »: the days with their window, the other hours of a day, « free all day »,
   what is sent to book, and a window just taken. (The server and the address search are pretended.) */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { addDays, today } from '../lib/dates';

const calls: { action: string; body: Record<string, unknown> }[] = [];
let answer: (action: string, body: Record<string, unknown>) => unknown = () => ({});
vi.mock('./api', async (orig) => {
  const real = await orig<typeof import('./api')>();
  return { ...real, callBook: async (action: string, body: Record<string, unknown> = {}) => { calls.push({ action, body }); return answer(action, body); } };
});
vi.mock('../shared/places/places', () => ({
  searchPlaces: async () => ({ error: null, places: [{ place: { address: '1250 rue Graham', unit: null, postal_code: null, city: 'Mont-Royal', lat: 45.5, lng: -73.6 },
    label: '1250 rue Graham', sub: 'Mont-Royal', exact: true, key: 'g', house: '1250', street: 'rue Graham', areas: ['Mont-Royal'] }] })
}));
import { BookPage } from './BookPage';
import { ClientError } from './api';

const D = (n: number) => addDays(today(), n);
const SVC = { id: 's1', name_fr: 'Huile', name_en: 'Oil', category: 'x', price_cents: 8000, taxable: true, duration_min: 45, promo: false, promo_until: null, includes: [] };
const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
const info = (windows: boolean) => ({ ok: true, garage: { name: 'Garage' }, on: true, windows, services: [SVC], blocks: BLOCKS, taxes: true, horizon_days: 120 });
const win = (n: number, a: number, near = false) => ({ day: D(n), block: 'day', near, win_start: a, win_end: a + 240 });

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const sp = (s: string | null | undefined) => String(s).replace(/\s/g, ' ');
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await wait(); };
const type = async (id: string, v: string) => { const el = q(id)[0] as HTMLInputElement; await act(async () => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }); };
/** from the first screen to the moments offered */
async function toSlots() {
  await act(async () => { render(<BookPage linkLang="fr" />, box); });
  await wait();
  await click(q('book-svc')[0]);
  await click(q('book-next')[0]);
  await type('book-address-input', '1250 rue Graham');
  await wait(420);
  await click(q('book-suggestion')[0]);
  await click(q('book-next')[0]);
  await wait();
}
async function fillContact(last = 'Web') {
  await type('book-first', 'Sophie'); await type('book-last', last); await type('book-phone', '514 555-1234');
  await type('book-make', 'Toyota'); await type('book-model', 'RAV4');
  await click(q('book-submit')[0]);
  await wait();
}
beforeEach(() => { calls.length = 0; window.scrollTo = () => undefined; });
afterEach(() => act(() => render(null, box)));

describe('Réserver en ligne, blocks (as before)', () => {
  it('the moments are blocks; a block is booked by its day and block only', async () => {
    answer = (a, b) => a === 'info' ? info(false) : a === 'slots' ? { ok: true, from: null, days: 14, slots: [{ day: D(2), block: 'pm', near: true }, { day: D(3), block: 'am', near: false }] }
      : { ok: true, link: null, day: b.day, block: b.block, text: 'sent' };
    await toSlots();
    expect(q('book-slot')).toHaveLength(2);
    expect(q('book-flex')).toHaveLength(0);
    expect(q('book-days')).toHaveLength(0);
    expect(sp(q('book-slot')[0].textContent)).toContain('Après-midi');
    expect(sp(q('book-slot')[0].textContent)).toContain('Entre 12 h et 16 h');
    await click(q('book-slot')[0]);
    expect(sp(q('book-summary')[0].textContent)).toContain('Entre 12 h et 16 h');
    await fillContact();
    const sent = calls.find((c) => c.action === 'book')!.body;
    expect(sent).toMatchObject({ day: D(2), block: 'pm' });
    expect('win_start' in sent || 'win_flex' in sent).toBe(false);
    expect(sp(q('book-done-when')[0].textContent)).toContain('entre 12 h et 16 h');
  });
});

describe('Réserver en ligne, « Plages d’arrivée »', () => {
  const slots = [win(2, 540, true), win(3, 840), win(2, 720), win(2, 960)];
  it('each day with its best window; « Voir d’autres heures » shows the day’s other windows; the window chosen is booked', async () => {
    answer = (a, b) => a === 'info' ? info(true) : a === 'slots' ? { ok: true, from: null, days: 14, slots }
      : { ok: true, link: 'x#t=abc', day: b.day, block: 'day', win_start: b.win_start, win_end: Number(b.win_start) + 240, flex: false, text: 'sent' };
    await toSlots();
    expect(q('book-day')).toHaveLength(2);
    expect(q('book-slot').map((x) => sp(x.querySelector('[data-testid="book-slot-when"]')?.textContent))).toEqual(['Entre 9 h et 13 h', 'Entre 14 h et 18 h']);
    expect(box.textContent).not.toMatch(/Matin|Après-midi|Soir/);
    expect(q('book-flex')).toHaveLength(1);
    expect(sp(q('book-flex-note')[0].textContent)).toMatch(/veille.*plage de 4 heures/);
    // only the day with several windows has the button
    expect(q('book-other-hours')).toHaveLength(1);
    expect(q('book-slot-other')).toHaveLength(0);
    await click(q('book-other-hours')[0]);
    expect(q('book-slot-other').map((x) => sp(x.textContent).replace('›', '').trim())).toEqual(['Entre 12 h et 16 h', 'Entre 16 h et 20 h']);
    await click(q('book-slot-other')[1]);
    expect(sp(q('book-summary-when')[0].textContent)).toBe('Entre 16 h et 20 h');
    await fillContact();
    const sent = calls.find((c) => c.action === 'book')!.body;
    expect(sent).toMatchObject({ day: D(2), block: 'day', win_start: 960 });
    expect('win_flex' in sent).toBe(false);
    expect(sp(q('book-done-when')[0].textContent)).toContain('entre 16 h et 20 h');
  });
  it('« Je suis disponible toute la journée »: the days without hours, booked flexible, the window promised for the day before', async () => {
    answer = (a, b) => a === 'info' ? info(true) : a === 'slots' ? { ok: true, from: null, days: 14, slots }
      : { ok: true, link: 'x#t=abc', day: b.day, block: 'day', win_start: null, win_end: null, flex: true, text: 'sent' };
    await toSlots();
    await click(q('book-flex')[0]);
    expect(q('book-slot').map((x) => sp(x.querySelector('[data-testid="book-slot-when"]')?.textContent))).toEqual(['Dans la journée', 'Dans la journée']);
    expect(q('book-other-hours')).toHaveLength(0);
    await click(q('book-slot')[1]);
    expect(sp(q('book-summary')[0].textContent)).toContain('Dans la journée');
    expect(sp(q('book-summary')[0].textContent)).toContain('Nous vous confirmons la veille une plage de 4 heures.');
    await fillContact();
    const sent = calls.find((c) => c.action === 'book')!.body;
    expect(sent).toMatchObject({ day: D(3), block: 'day', win_flex: true });
    expect('win_start' in sent).toBe(false);
    expect(sp(q('book-done-when')[0].textContent)).toMatch(/dans la journée\. Nous vous confirmons la veille une plage de 4 heures\./);
  });
  it('a window just taken (`window_full`): back to the windows, asked again, with clear words', async () => {
    answer = (a) => { if (a === 'info') return info(true); if (a === 'slots') return { ok: true, from: null, days: 14, slots }; throw new ClientError('window_full', 'pris', null); };
    await toSlots();
    await click(q('book-slot')[0]);
    await fillContact();
    expect(q('book-slots')).toHaveLength(1);
    expect(sp(box.textContent)).toContain('Cette plage vient d’être prise. Voici les plages encore libres.');
    expect(calls.filter((c) => c.action === 'slots')).toHaveLength(2);
    expect(q('book-slot')).toHaveLength(2);
  });
});
