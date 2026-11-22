/* « Réserver en ligne » with « Plages d’arrivée »: the days with their window, the other hours of a day, « free all day »,
   what is sent to book, and a window just taken. (The server and the address search are pretended.) */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { addDays, today } from '../../lib/dates';

const calls: { action: string; body: Record<string, unknown> }[] = [];
let answer: (action: string, body: Record<string, unknown>) => unknown = () => ({});
vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  return { ...real, callBook: async (action: string, body: Record<string, unknown> = {}) => { calls.push({ action, body }); return answer(action, body); } };
});
vi.mock('../../shared/places/places', () => ({
  searchPlaces: async () => ({ error: null, places: [{ place: { address: '1250 rue Graham', unit: null, postal_code: null, city: 'Mont-Royal', lat: 45.5, lng: -73.6 },
    label: '1250 rue Graham', sub: 'Mont-Royal', exact: true, key: 'g', house: '1250', street: 'rue Graham', areas: ['Mont-Royal'] }] })
}));
import { BookPage } from './BookPage';
import { ClientError } from '../api';

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
      : { ok: true, link: 'x#t=abc', day: b.day, block: b.block, text: 'sent' };   // a real booking always comes with its link
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

describe('Réserver en ligne, when something goes wrong', () => {
  it('a failed first request of the moments says so with « Réessayer », never « Aucun autre moment libre » (client-page-08)', async () => {
    let fail = true;
    answer = (a) => {
      if (a === 'info') return info(false);
      if (a === 'slots') { if (fail) throw new ClientError('network', 'Failed to fetch'); return { ok: true, from: null, days: 14, slots: [{ day: D(2), block: 'pm', near: true }] }; }
      return {};
    };
    await toSlots();
    expect(sp(box.textContent)).toContain('Pas de réseau');
    expect(sp(box.textContent)).not.toContain('Aucun autre moment libre');
    expect(q('book-more')).toHaveLength(0);
    fail = false;
    await click(q('book-retry')[0]);
    expect(q('book-slot')).toHaveLength(1);
    expect(q('book-retry')).toHaveLength(0);
  });
  it('« busy » (429) on the moments: the words and « Réessayer », not « no moment » (client-page-08)', async () => {
    answer = (a) => { if (a === 'info') return info(false); if (a === 'slots') throw new ClientError('busy', 'x'); return {}; };
    await toSlots();
    expect(sp(box.textContent)).toContain('beaucoup de réservations');
    expect(q('book-retry')).toHaveLength(1);
    expect(sp(box.textContent)).not.toContain('Aucun autre moment libre');
  });
  it('« Voir d’autres dates » looks past an empty fortnight instead of giving up (client-page-14)', async () => {
    answer = (a, b) => {
      if (a === 'info') return info(false);
      if (a === 'slots') {
        if (!b.from) return { ok: true, from: null, days: 14, slots: [{ day: D(2), block: 'pm', near: true }] };
        // the next two weeks are closed (holidays); the fortnight after has room
        return { ok: true, from: b.from, days: 14, slots: String(b.from) >= D(28) ? [{ day: D(30), block: 'am', near: false }] : [] };
      }
      return {};
    };
    await toSlots();
    await click(q('book-more')[0]);
    await wait();
    expect(q('book-slot')).toHaveLength(2);
    expect(sp(box.textContent)).not.toContain('Aucun autre moment libre');
    expect(q('book-more')).toHaveLength(1);
  });
  it('« Voir d’autres dates » that finds nothing in the weeks it looked at says so, instead of nothing (client-r7)', async () => {
    answer = (a, b) => {
      if (a === 'info') return info(false);
      if (a === 'slots') return { ok: true, from: b.from ?? null, days: 14, slots: b.from ? [] : [{ day: D(2), block: 'pm', near: true }] };
      return {};
    };
    await toSlots();
    expect(q('book-none-new')).toHaveLength(0);
    await click(q('book-more')[0]);
    await wait();
    expect(calls.filter((c) => c.action === 'slots')).toHaveLength(5);         // the first page, then 4 empty fortnights
    expect(sp(q('book-none-new')[0]?.textContent)).toBe('Aucun moment libre dans ces jours-là.');
    expect(q('book-slot')).toHaveLength(1);
    expect(q('book-more')).toHaveLength(1);                                     // the horizon is still ahead
  });
  it('an answer without the customer’s link is not « C’est réservé » (client-page-17)', async () => {
    answer = (a, b) => a === 'info' ? info(false) : a === 'slots' ? { ok: true, from: null, days: 14, slots: [{ day: D(2), block: 'pm', near: true }] }
      : { ok: true, link: null, day: b.day, block: b.block, text: 'skipped' };
    await toSlots();
    await click(q('book-slot')[0]);
    await fillContact();
    expect(q('book-done')).toHaveLength(0);
    expect(q('book-unconfirmed')).toHaveLength(1);
    expect(sp(box.textContent)).not.toContain('C’est réservé');
  });
  it('the first « Réserver » with a field missing puts the focus on it (client-page-27)', async () => {
    answer = (a) => a === 'info' ? info(false) : a === 'slots' ? { ok: true, from: null, days: 14, slots: [{ day: D(2), block: 'pm', near: true }] } : {};
    await toSlots();
    await click(q('book-slot')[0]);
    // the new step's title takes the focus 30 ms after it is drawn: a person taps later than that. Wait for it to have
    // happened (not a fixed time: on a busy machine the 30 ms timer could fire after the tap and take the focus back — tests-05)
    for (let i = 0; i < 200 && document.activeElement !== box.querySelector('#bk-t4'); i++) await wait(10);
    expect(document.activeElement).toBe(box.querySelector('#bk-t4'));
    await click(q('book-submit')[0]);
    expect(document.activeElement).toBe(q('book-first')[0]);
    expect(calls.some((c) => c.action === 'book')).toBe(false);
  });
});

describe('« Vraies routes » on, an address whose trips could not be measured (decision 6, critic W1)', () => {
  it('no moment offered and the server says some were left out (unmeasured): its own sentence, never « Aucun moment libre »', async () => {
    answer = (a) => a === 'info' ? info(false) : a === 'slots' ? { ok: true, from: null, days: 14, slots: [], unmeasured: 4 } : {};
    await toSlots();
    const said = sp(q('book-none')[0]?.textContent);
    expect(said).toBe('On ne peut pas proposer de moment en ligne pour cette adresse en ce moment : appelez-nous.');
    expect(said).not.toContain('Aucun moment libre');
  });
  it('nothing left out (switch off, or nothing free): « Aucun moment libre » as before', async () => {
    answer = (a) => a === 'info' ? info(false) : a === 'slots' ? { ok: true, from: null, days: 14, slots: [] } : {};
    await toSlots();
    expect(sp(q('book-none')[0]?.textContent)).toBe('Aucun moment libre dans ces jours-là.');
  });
  it('« Voir d’autres dates » on a page that could not be measured: the sentence, and no later fortnight asked', async () => {
    let n = 0;
    answer = (a) => a === 'info' ? info(false) : a === 'slots' ? (n++ === 0 ? { ok: true, from: null, days: 14, slots: [{ day: D(2), block: 'pm', near: true }] } : { ok: true, days: 14, slots: [], unmeasured: 2 }) : {};
    await toSlots();
    await click(q('book-more')[0]);
    expect(calls.filter((c) => c.action === 'slots')).toHaveLength(2);
    expect(sp(q('book-none-new')[0]?.textContent)).toBe('On ne peut pas proposer de moment en ligne pour cette adresse en ce moment : appelez-nous.');
  });
});
