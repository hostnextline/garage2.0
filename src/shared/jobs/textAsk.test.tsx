/* « Texter … ? » (Hassan, 2026-11-22: « the system should ask me first »): after a change of an appointment the « moved »
   text never goes by itself. The question says the new moment; « Envoyer le texto » is the very send of before (once),
   « Pas maintenant » and closing send nothing; two changes of the same appointment: one question with the latest moment; two
   appointments: one question each, in turn. Part 28 (REARRANGE.md §3.6, U6): « Pas maintenant » says his new time goes
   with « Envoyer les heures aux clients » and then shows the told day's toast (toldDayToast, pretended here); never after
   « Envoyer le texto », never beside a question. The server (notify) is pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const api = vi.hoisted(() => ({ notify: vi.fn() }));
const sync = vi.hoisted(() => ({ pull: vi.fn(() => Promise.resolve()), refetch: vi.fn(() => Promise.resolve()) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<object>()), ...sync }));
// E4's toast of the day the customer was TOLD (its own rule decides whether it shows): only its calls are looked at here
const told = vi.hoisted(() => ({ toldDayToast: vi.fn() }));
vi.mock('./ToldBits', () => told);

import { askMovedText, textAsksWaiting, clearTextAsks, movedWhen, toldDayAfter, TEXT_ASK_DEAD_MS } from './textAsk';
import { outcome } from './texts';
import { TextOutcomeHost } from './TextOutcome';
import { toasts } from '../../ui/toast';
import { replaceLocal, upsertLocal, removeLocal, clearAll, getRow } from '../../data/store';
import { whenHistorySettled, stackOf } from '../../platform/history';
import { navigate } from '../../platform/router';
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
    expect(q('text-ask-skip')!.textContent).toContain('Pas maintenant');
    expect(q('text-ask-later')!.textContent).toBe('Pas maintenant : rien ne part, sa nouvelle heure partira avec « Envoyer les heures aux clients ».');
    expect(api.notify).not.toHaveBeenCalled();
  });

  it('a block appointment: the day, the block and its hours', () => {
    expect(movedWhen(job('j2'))).toBe('Mardi 15 janvier 2030, après-midi (12 h à 16 h)');
    lang.value = 'en';
    expect(movedWhen(job('j2'))).toMatch(/^Tuesday, January 15, 2030, afternoon \(12/);
  });

  it('« Envoyer le texto »: the very send of before, once (a second tap sends nothing more)', async () => {
    // a job screen: its « text to send by hand » host is there, so the job screens' send (sendText)
    const box = document.createElement('div'); document.body.appendChild(box);
    await act(async () => { render(<TextOutcomeHost />, box); });
    askMovedText(job(), { via: 'jobs' });
    await settle(); await ripe();
    await act(async () => { q('text-ask-send')!.click(); q('text-ask-send')?.click(); });
    await settle();
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(api.notify.mock.calls[0]).toEqual(['moved', 'j1', { op: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    expect(q('text-ask')).toBeNull();
    expect(toasts.value.map((x) => x.text)).toContain('Texto envoyé à Julie.');
    await act(async () => { render(null, box); });
    box.remove();
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

  it('the job screens’ send (their « text to send by hand » host is there): texting off → that sheet’s outcome', async () => {
    const box = document.createElement('div'); document.body.appendChild(box);
    await act(async () => { render(<TextOutcomeHost />, box); });
    api.notify.mockResolvedValue({ ok: true, status: 'off', message: 'Bonjour Julie', link: null, phone: '5145550141' });
    askMovedText(job(), { via: 'jobs' });
    await settle(); await ripe();
    await click('text-ask-send');
    expect(outcome.value).toMatchObject({ status: 'off', message: 'Bonjour Julie' });
    expect(q('text-outcome')).not.toBeNull();
    await act(async () => { outcome.value = null; render(null, box); });
    box.remove();
  });

  it('« Pas maintenant »: nothing is sent', async () => {
    askMovedText(job(), { via: 'jobs' });
    await settle(); await ripe();
    await click('text-ask-skip');
    expect(q('text-ask')).toBeNull();
    expect(api.notify).not.toHaveBeenCalled();
    expect(textAsksWaiting()).toEqual([]);
  });

  it('closing the sheet (✕, Escape) is « Pas maintenant »', async () => {
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
    expect(q('text-ask-skip')!.textContent).toContain('Not now');
    expect(q('text-ask-later')!.textContent).toBe('Not now: nothing goes, their new time goes with “Send the times to customers”.');
  });
});

/* The fixer's round (reviews ask-first-review-paths / -screen, 2026-11-22): what the person sees after « Envoyer le
   texto » on any screen, the moment said when the row leaves the phone, a navigation, the back button, two questions. */
describe('the question « Texter … ? »: the reviews’ findings', () => {
  const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));
  const settled = () => new Promise<void>((r) => whenHistorySettled(() => setTimeout(r, 0)));
  /** every timer and step back of the history landed */
  async function calm() { for (let i = 0; i < 8; i++) await act(async () => { await tick(); await settled(); }); }
  const steps = () => stackOf(history.state).length;
  const back = async () => { await act(async () => { history.back(); }); await calm(); };
  const fresh = async () => { await calm(); await act(() => tick(TEXT_ASK_DEAD_MS + 40)); };
  const title = () => q('text-ask')?.querySelector('h2')?.textContent ?? null;
  let box: HTMLDivElement | null = null;
  /** a screen with the job screens' « text to send by hand » host (Aujourd'hui, a job, MoveHost) */
  const withHost = async () => { box = document.createElement('div'); document.body.appendChild(box); await act(async () => { render(<TextOutcomeHost />, box!); }); };
  beforeEach(async () => { await calm(); history.replaceState({ d: 0 }, '', '/#/map'); });
  afterEach(async () => {
    await act(async () => { clearTextAsks(); outcome.value = null; if (box) render(null, box); });
    box?.remove(); box = null;
    await calm();
  });

  it('F1 / L2: « Envoyer le texto » on a screen with no « text to send by hand » host (texting off): the agenda’s send, seen there (a toast with « Voir le texto »), nothing left to pop up later', async () => {
    api.notify.mockResolvedValue({ ok: true, status: 'off', message: 'Bonjour Julie, votre rendez-vous a changé', link: null, phone: '5145550141' });
    // a move kept on the Carte lands while the person is on the agenda (MoveHost asks via the job screens' send)
    askMovedText(job(), { via: 'jobs' });
    await fresh();
    await act(async () => { q('text-ask-send')!.click(); });
    await calm();
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(api.notify.mock.calls[0].slice(0, 2)).toEqual(['moved', 'j1']);
    expect(toasts.value.some((x) => !!x.action)).toBe(true);
    expect(outcome.value).toBeNull();
    // later, on a screen that has the host: nothing stale rises
    await withHost();
    await calm();
    expect(q('text-outcome')).toBeNull();
  });

  it('F1: texts connected, no host: « Texto envoyé » is said there too', async () => {
    askMovedText(job(), { via: 'jobs' });
    await fresh();
    await act(async () => { q('text-ask-send')!.click(); });
    await calm();
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(toasts.value.filter((x) => x.kind === 'ok').length).toBe(1);
  });

  it('F2 / M3: the phone stops holding the row while the question is up (another truck’s, a narrow copy): it still says the NEW moment', async () => {
    const before = job();                              // Tuesday 13–17, as « Déplacer » / « Changer de camion » pass it
    await act(async () => { upsertLocal('jobs', [{ ...JOB, day: LATER, win_start: 540, win_end: 780 }] as never, { force: true }); });
    askMovedText(before, { via: 'jobs' });
    await fresh();
    expect(q('text-ask-when')!.textContent).toBe('Jeudi 17 janvier 2030, entre 9 h et 13 h');
    await act(async () => { removeLocal('jobs', ['j1']); });
    await calm();
    expect(title()).toBe('Texter Julie ?');
    expect(q('text-ask-when')!.textContent).toBe('Jeudi 17 janvier 2030, entre 9 h et 13 h');
  });

  it('F4: the customer changed meanwhile (« Changer de client » on another phone): the toast names the one texted', async () => {
    await withHost();
    askMovedText(job(), { via: 'jobs' });
    await fresh();
    await act(async () => { upsertLocal('jobs', [{ ...JOB, customer_id: 'c2' }] as never, { force: true }); });
    await calm();
    expect(title()).toBe('Texter Carla ?');
    await act(async () => { q('text-ask-send')!.click(); });
    await calm();
    expect(toasts.value.map((x) => x.text)).toContain('Texto envoyé à Carla.');
    expect(toasts.value.map((x) => x.text)).not.toContain('Texto envoyé à Julie.');
  });

  it('M1 / F3: a navigation (the « Voir » of the move’s message) never answers it: the question rises again on the next screen, with its own step', async () => {
    askMovedText(job(), { via: 'jobs' });
    await fresh();
    expect(title()).toBe('Texter Julie ?');
    await act(async () => { navigate('/job/j1'); });
    await calm();
    expect(location.hash).toBe('#/job/j1');
    expect(textAsksWaiting()).toEqual(['j1']);
    expect(title()).toBe('Texter Julie ?');
    expect(steps()).toBe(1);
    expect(api.notify).not.toHaveBeenCalled();
    // then « Pas maintenant » there: nothing sent, its step goes, the job screen stays
    await act(() => tick(TEXT_ASK_DEAD_MS + 40));
    await act(async () => { q('text-ask-skip')!.click(); });
    await calm();
    expect(q('text-ask')).toBeNull();
    expect(steps()).toBe(0);
    expect(location.hash).toBe('#/job/j1');
    expect(api.notify).not.toHaveBeenCalled();
  });

  it('L3: the phone’s back button is « Pas maintenant »: one question, then two in turn; the screen stays', async () => {
    askMovedText(job(), { via: 'jobs' });
    await fresh();
    expect(steps()).toBe(1);
    await back();
    expect(q('text-ask')).toBeNull();
    expect(steps()).toBe(0);
    expect(location.hash).toBe('#/map');
    askMovedText(job('j1'), { via: 'notify' });
    askMovedText(job('j2'), { via: 'notify' });
    await fresh();
    expect(title()).toBe('Texter Julie ?');
    await back();
    expect(title()).toBe('Texter Carla ?');
    expect(steps()).toBe(1);
    await back();
    expect(q('text-ask')).toBeNull();
    expect(steps()).toBe(0);
    expect(location.hash).toBe('#/map');
    expect(api.notify).not.toHaveBeenCalled();
  });

  it('L1: two questions, the first sent with texting off: its « text to send by hand » sheet comes first, ALONE; the next question once it is closed', async () => {
    await withHost();
    api.notify.mockResolvedValue({ ok: true, status: 'off', message: 'Bonjour Julie', link: null, phone: '5145550141' });
    askMovedText(job('j1'), { via: 'jobs' });
    askMovedText(job('j2'), { via: 'jobs' });
    await fresh();
    await act(async () => { q('text-ask-send')!.click(); });
    await calm();
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(q('text-outcome')).not.toBeNull();
    expect(q('text-ask')).toBeNull();
    expect(textAsksWaiting()).toEqual(['j2']);
    // « Fermer » on the hand-text sheet: then Carla's question
    await act(async () => { q('text-outcome')!.querySelector<HTMLElement>('.sheet-x')!.click(); });
    await calm();
    expect(q('text-outcome')).toBeNull();
    expect(title()).toBe('Texter Carla ?');
  });

  it('L1: the next question waits for the first send’s answer (never over it while the network answers)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    api.notify.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    askMovedText(job('j1'), { via: 'notify' });
    askMovedText(job('j2'), { via: 'notify' });
    await fresh();
    await act(async () => { q('text-ask-send')!.click(); });
    await calm();
    expect(q('text-ask')).toBeNull();
    await act(async () => { answer({ ok: true, status: 'sent', message: 'x', link: null, phone: '5145550141' }); });
    await calm();
    expect(title()).toBe('Texter Carla ?');
  });
});

/* Part 28 (REARRANGE.md §3.6 points 1-2, §3.5 « Pas maintenant », U6, days F3): « Pas maintenant » leaves the customer due
   for « Envoyer les heures aux clients »; the toast of the day he was TOLD comes after it (toldDayToast decides whether
   that day is today and the move changed it), or after a move that asked nothing; never beside a question, never after
   « Envoyer le texto ». */
describe('« Pas maintenant » and the told day’s toast (Part 28)', () => {
  const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));
  const settled = () => new Promise<void>((r) => whenHistorySettled(() => setTimeout(r, 0)));
  async function calm() { for (let i = 0; i < 8; i++) await act(async () => { await tick(); await settled(); }); }
  const fresh = async () => { await calm(); await act(() => tick(TEXT_ASK_DEAD_MS + 40)); };
  const title = () => q('text-ask')?.querySelector('h2')?.textContent ?? null;
  /** Denis (j1) was told TODAY 13 h à 17 h; the move takes him to Thursday */
  const TODAY = '2030-01-15';
  const denis = (): Job => ({ ...job(), told_day: TODAY, told_start: 780, told_end: 1020, told_at: '2030-01-15T12:00:00.000000+00:00', told_how: 'sms' } as Job);
  const movedTo = async (day: string, ws = 540, we = 780) => { await act(async () => { upsertLocal('jobs', [{ ...denis(), day, win_start: ws, win_end: we }] as never, { force: true }); }); };
  beforeEach(async () => { await calm(); history.replaceState({ d: 0 }, '', '/#/agenda'); told.toldDayToast.mockClear(); });
  afterEach(async () => { await act(async () => { clearTextAsks(); outcome.value = null; }); await calm(); });

  it('« Pas maintenant »: nothing sent, the toast of his told day with the job as it was BEFORE the move', async () => {
    const before = denis();
    await movedTo(LATER);
    askMovedText(before, { via: 'notify' });
    await fresh();
    // while the question is up: no toast (never beside a question)
    expect(told.toldDayToast).not.toHaveBeenCalled();
    await act(async () => { q('text-ask-skip')!.click(); });
    await calm();
    expect(q('text-ask')).toBeNull();
    expect(api.notify).not.toHaveBeenCalled();
    expect(told.toldDayToast).toHaveBeenCalledTimes(1);
    expect(told.toldDayToast.mock.calls[0][0]).toMatchObject({ id: 'j1', day: DAY, told_day: TODAY, win_start: 780 });
  });

  it('closing it (✕) or the back button is « Pas maintenant »: the same toast, once each', async () => {
    askMovedText(denis(), { via: 'notify' });
    await fresh();
    await act(async () => { q('text-ask')!.querySelector<HTMLElement>('.sheet-x')!.click(); });
    await calm();
    expect(told.toldDayToast).toHaveBeenCalledTimes(1);
    askMovedText(denis(), { via: 'jobs' });
    await fresh();
    await act(async () => { history.back(); });
    await calm();
    expect(q('text-ask')).toBeNull();
    expect(told.toldDayToast).toHaveBeenCalledTimes(2);
    expect(api.notify).not.toHaveBeenCalled();
  });

  it('« Envoyer le texto »: sent once, and NO told-day toast (he is told by that text)', async () => {
    askMovedText(denis(), { via: 'notify' });
    await fresh();
    await act(async () => { q('text-ask-send')!.click(); });
    await calm();
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(told.toldDayToast).not.toHaveBeenCalled();
  });

  it('a navigation (« Voir ») does not answer it: no toast until it is answered on the next screen', async () => {
    askMovedText(denis(), { via: 'jobs' });
    await fresh();
    await act(async () => { navigate('/job/j1'); });
    await calm();
    expect(title()).toBe('Texter Julie ?');
    expect(told.toldDayToast).not.toHaveBeenCalled();
    await act(() => tick(TEXT_ASK_DEAD_MS + 40));
    await act(async () => { q('text-ask-skip')!.click(); });
    await calm();
    expect(told.toldDayToast).toHaveBeenCalledTimes(1);
  });

  it('two changes before the answer: one question, and the toast compares with the job before the FIRST change', async () => {
    const first = denis();
    await movedTo(LATER);
    askMovedText(first, { via: 'notify' });
    await fresh();
    const second = job();                                   // Thursday, as the second move's sheet showed it
    await movedTo('2030-01-18', 600, 840);
    askMovedText(second, { via: 'notify' });
    await fresh();
    expect(textAsksWaiting()).toEqual(['j1']);
    await act(async () => { q('text-ask-skip')!.click(); });
    await calm();
    expect(told.toldDayToast).toHaveBeenCalledTimes(1);
    expect(told.toldDayToast.mock.calls[0][0]).toMatchObject({ id: 'j1', day: DAY, win_start: 780 });
  });

  it('a flow that asked nothing (texts off, no cell): the toast at once, from the job before the move', async () => {
    replaceLocal('settings', [{ id: '1', messages: { on: { moved: false } } }] as never);
    const before = denis();
    expect(askMovedText(before, { via: 'notify' })).toBe(false);
    toldDayAfter(before);
    expect(told.toldDayToast).toHaveBeenCalledTimes(1);
    expect(told.toldDayToast.mock.calls[0][0]).toBe(before);
    await calm();
    expect(q('text-ask')).toBeNull();
  });

  it('never beside a question: a flow’s toast waits while another customer’s question is up, then shows once it is answered', async () => {
    askMovedText(job('j2'), { via: 'notify' });           // Carla's question
    const before = denis();
    toldDayAfter(before);                                  // Denis's move asked nothing, at the same time
    expect(told.toldDayToast).not.toHaveBeenCalled();      // the question is about to open: held
    await fresh();
    expect(title()).toBe('Texter Carla ?');
    expect(told.toldDayToast).not.toHaveBeenCalled();
    await act(async () => { q('text-ask-send')!.click(); });
    await calm();
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(api.notify.mock.calls[0][1]).toBe('j2');
    // Carla was texted: no toast for her; Denis's held toast now
    expect(told.toldDayToast).toHaveBeenCalledTimes(1);
    expect(told.toldDayToast.mock.calls[0][0]).toBe(before);
  });

  it('with E4’s real toast: Julie told TODAY 13 h à 17 h, moved to another day, « Pas maintenant » → « Julie attendait aujourd’hui … » with that day’s button (days F3)', async () => {
    const real = await vi.importActual<typeof import('./ToldBits')>('./ToldBits');
    told.toldDayToast.mockImplementation(real.toldDayToast);
    const { access } = await import('../../data/auth');
    const { today, addDays } = await import('../../lib/dates');
    access.value = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as never;
    try {
      const now = today();
      const toldToday = { ...JOB, day: now, told_day: now, told_start: 780, told_end: 1020, told_at: `${now}T12:00:00.000000+00:00`, told_how: 'sms' };
      replaceLocal('jobs', [toldToday] as never);
      const before = job();
      await act(async () => { upsertLocal('jobs', [{ ...toldToday, day: addDays(now, 4), win_start: 540, win_end: 780 }] as never, { force: true }); });
      askMovedText(before, { via: 'notify' });
      await fresh();
      expect(toasts.value.filter((x) => x.text.includes('attendait'))).toEqual([]);
      await act(async () => { q('text-ask-skip')!.click(); });
      await calm();
      const tt = toasts.value.filter((x) => x.text.includes('attendait'));
      expect(tt.map((x) => x.text)).toEqual(['Julie attendait aujourd’hui : sa nouvelle heure n’est pas partie.']);
      expect(tt[0].action?.label).toBe('Envoyer les heures aux clients (1)');
      expect(api.notify).not.toHaveBeenCalled();
      // « Envoyer le texto » instead (the server writes told): no such toast
      toasts.value = [];
      askMovedText(before, { via: 'notify' });
      await fresh();
      await act(async () => { q('text-ask-send')!.click(); });
      await calm();
      expect(toasts.value.filter((x) => x.text.includes('attendait'))).toEqual([]);
    } finally {
      told.toldDayToast.mockReset();
      access.value = null;
    }
  });

  it('two questions: the first « Pas maintenant », its toast only once the second is answered too', async () => {
    askMovedText(denis(), { via: 'notify' });
    askMovedText(job('j2'), { via: 'notify' });
    await fresh();
    await act(async () => { q('text-ask-skip')!.click(); });
    await calm();
    expect(title()).toBe('Texter Carla ?');
    expect(told.toldDayToast).not.toHaveBeenCalled();
    await act(() => tick(TEXT_ASK_DEAD_MS + 40));
    await act(async () => { q('text-ask-skip')!.click(); });
    await calm();
    expect(told.toldDayToast).toHaveBeenCalledTimes(2);
    expect(told.toldDayToast.mock.calls.map((c) => (c[0] as Job).id)).toEqual(['j1', 'j2']);
    expect(api.notify).not.toHaveBeenCalled();
  });
});
