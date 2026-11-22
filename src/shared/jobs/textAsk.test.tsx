/* « Texter … ? » (Hassan, 2026-11-22: « the system should ask me first »): after a change of an appointment the « moved »
   text never goes by itself. The question says the new moment; « Envoyer le texto » is the very send of before (once),
   « Pas de texto » and closing send nothing; two changes of the same appointment: one question with the latest moment; two
   appointments: one question each, in turn. The server (notify) is pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'preact/test-utils';

const api = vi.hoisted(() => ({ notify: vi.fn() }));
const sync = vi.hoisted(() => ({ pull: vi.fn(() => Promise.resolve()), refetch: vi.fn(() => Promise.resolve()) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<object>()), ...sync }));

import { askMovedText, textAsksWaiting, clearTextAsks, movedWhen, TEXT_ASK_DEAD_MS } from './textAsk';
import { outcome } from './texts';
import { toasts } from '../../ui/toast';
import { replaceLocal, upsertLocal, clearAll, getRow } from '../../data/store';
import { lang } from '../../lib/i18n';
import type { Job } from '../../data/types';

const DAY = '2030-01-15';   // a Tuesday
const LATER = '2030-01-17'; // a Thursday
const JOB = { id: 'j1', number: 7, customer_id: 'c1', truck_id: 't1', day: DAY, block: 'day', status: 'booked', duration_min: 60, eta_min: 840, win_start: 780, win_end: 1020, win_flex: false };
const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid="${s}"]`);
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); for (let i = 0; i < 6; i++) await Promise.resolve(); });
/** the question on screen (it waits for the history's step back of a sheet closed just before: up to 700 ms), or null */
async function shown(): Promise<HTMLElement | null> {
  await settle();
  for (let i = 0; i < 60 && !q('text-ask'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return q('text-ask');
}
/** a question just shown ignores taps for a moment (the second tap of a double tap) */
const ripe = async () => { await shown(); await act(async () => { await new Promise((r) => setTimeout(r, TEXT_ASK_DEAD_MS + 40)); }); };
const click = async (s: string) => { await act(async () => { q(s)!.click(); }); await settle(); };
const job = (id = 'j1') => getRow<Job>('jobs', id)!;

beforeEach(() => {
  vi.clearAllMocks();
  lang.value = 'fr'; toasts.value = []; outcome.value = null;
  replaceLocal('settings', [{ id: '1', booking: { windows_on: true, win_before_min: 60, win_after_min: 180, blocks: [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }] }, messages: { on: { moved: true } } }] as never);
  replaceLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'T', phone: '5145550141', sms_ok: true }, { id: 'c2', first_name: 'Carla', last_name: 'C', phone: '5145550142', sms_ok: true }] as never);
  replaceLocal('jobs', [JOB, { ...JOB, id: 'j2', number: 8, customer_id: 'c2', block: 'pm', win_start: null, win_end: null }] as never);
  api.notify.mockResolvedValue({ ok: true, status: 'sent', message: 'Bonjour Julie, votre rendez-vous a changé', link: null, phone: '5145550141' });
});
afterEach(async () => {
  await act(async () => { clearTextAsks(); });
  clearAll();
});

describe('the question « Texter … ? » (ask first)', () => {
  it('asks, sends nothing by itself, and says the new moment as the text says it', async () => {
    expect(askMovedText(job(), { via: 'jobs' })).toBe(true);
    expect(await shown()).not.toBeNull();
    expect(q('text-ask')!.querySelector('h2')!.textContent).toBe('Texter Julie ?');
    expect(q('text-ask-when')!.textContent).toBe('Mardi 15 janvier 2030, entre 13 h et 17 h');
    expect(q('text-ask-send')!.textContent).toContain('Envoyer le texto');
    expect(q('text-ask-skip')!.textContent).toContain('Pas de texto');
    expect(api.notify).not.toHaveBeenCalled();
  });

  it('a block appointment: the day, the block and its hours', () => {
    expect(movedWhen(job('j2'))).toBe('Mardi 15 janvier 2030, après-midi (12 h à 16 h)');
    lang.value = 'en';
    expect(movedWhen(job('j2'))).toMatch(/^Tuesday, January 15, 2030, afternoon \(12/);
  });

  it('« Envoyer le texto »: the very send of before, once (a second tap sends nothing more)', async () => {
    askMovedText(job(), { via: 'jobs' });
    await settle(); await ripe();
    await act(async () => { q('text-ask-send')!.click(); q('text-ask-send')?.click(); });
    await settle();
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(api.notify.mock.calls[0]).toEqual(['moved', 'j1', { op: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    expect(q('text-ask')).toBeNull();
    expect(toasts.value.map((x) => x.text)).toContain('Texto envoyé à Julie.');
  });

  it('the agenda’s send (notifyCustomer) and its outcomes: texting off → the text to send by hand', async () => {
    api.notify.mockResolvedValue({ ok: true, status: 'off', message: 'Bonjour Julie, votre rendez-vous a changé', link: 'https://x/client.html#t=abc', phone: '5145550141' });
    askMovedText('j1', { via: 'notify' });
    await settle(); await ripe();
    await click('text-ask-send');
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(api.notify.mock.calls[0].slice(0, 2)).toEqual(['moved', 'j1']);
    // « Les textos automatiques ne sont pas branchés » with « Voir le texto »
    expect(toasts.value.some((x) => !!x.action)).toBe(true);
  });

  it('the job screens’ send: texting off → the « text to send by hand » sheet’s outcome', async () => {
    api.notify.mockResolvedValue({ ok: true, status: 'off', message: 'Bonjour Julie', link: null, phone: '5145550141' });
    askMovedText(job(), { via: 'jobs' });
    await settle(); await ripe();
    await click('text-ask-send');
    expect(outcome.value).toMatchObject({ status: 'off', message: 'Bonjour Julie' });
  });

  it('« Pas de texto »: nothing is sent', async () => {
    askMovedText(job(), { via: 'jobs' });
    await settle(); await ripe();
    await click('text-ask-skip');
    expect(q('text-ask')).toBeNull();
    expect(api.notify).not.toHaveBeenCalled();
    expect(textAsksWaiting()).toEqual([]);
  });

  it('closing the sheet (✕, Escape) is « Pas de texto »', async () => {
    askMovedText(job(), { via: 'notify' });
    await shown();
    await act(async () => { q('text-ask')!.querySelector<HTMLElement>('.sheet-x')!.click(); });
    await settle();
    expect(q('text-ask')).toBeNull();
    askMovedText(job(), { via: 'notify' });
    expect(await shown()).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await settle();
    expect(q('text-ask')).toBeNull();
    expect(api.notify).not.toHaveBeenCalled();
  });

  it('the same appointment changed twice before the answer: ONE question, with the latest moment; one text', async () => {
    askMovedText(job(), { via: 'jobs' });
    await shown();
    // moved again (a move kept on the phone landing, another phone): the phone's row says Thursday 9 h – 13 h now
    await act(async () => { upsertLocal('jobs', [{ ...JOB, day: LATER, win_start: 540, win_end: 780 }] as never, { force: true }); });
    askMovedText(job(), { via: 'jobs' });
    await settle(); await ripe();
    expect(textAsksWaiting()).toEqual(['j1']);
    expect(document.querySelectorAll('[data-testid="text-ask"]').length).toBe(1);
    expect(q('text-ask-when')!.textContent).toBe('Jeudi 17 janvier 2030, entre 9 h et 13 h');
    await click('text-ask-send');
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(q('text-ask')).toBeNull();
  });

  it('two appointments: one question each, one after the other', async () => {
    askMovedText(job('j1'), { via: 'jobs' });
    askMovedText(job('j2'), { via: 'jobs' });
    await shown();
    expect(textAsksWaiting()).toEqual(['j1', 'j2']);
    expect(q('text-ask')!.querySelector('h2')!.textContent).toBe('Texter Julie ?');
    await ripe();
    await click('text-ask-skip');
    expect(q('text-ask')!.querySelector('h2')!.textContent).toBe('Texter Carla ?');
    await ripe();
    await click('text-ask-send');
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(api.notify.mock.calls[0][1]).toBe('j2');
    expect(q('text-ask')).toBeNull();
  });

  it('asks nothing when no text would go: « Rendez-vous changé » off, no number, the customer takes no texts', async () => {
    replaceLocal('settings', [{ id: '1', messages: { on: { moved: false } } }] as never);
    expect(askMovedText(job(), { via: 'jobs' })).toBe(false);
    replaceLocal('settings', [{ id: '1', messages: { on: { moved: true } } }] as never);
    upsertLocal('customers', [{ id: 'c1', first_name: 'Julie', phone: null, sms_ok: true }] as never, { force: true });
    expect(askMovedText(job(), { via: 'notify' })).toBe(false);
    upsertLocal('customers', [{ id: 'c1', first_name: 'Julie', phone: '5145550141', sms_ok: false }] as never, { force: true });
    expect(askMovedText(job(), { via: 'jobs' })).toBe(false);
    await settle();
    expect(q('text-ask')).toBeNull();
    expect(api.notify).not.toHaveBeenCalled();
  });

  it('English words', async () => {
    lang.value = 'en';
    askMovedText(job(), { via: 'jobs' });
    await shown();
    expect(q('text-ask')!.querySelector('h2')!.textContent).toBe('Text Julie?');
    expect(q('text-ask-send')!.textContent).toContain('Send the text');
    expect(q('text-ask-skip')!.textContent).toContain('No text');
  });
});
