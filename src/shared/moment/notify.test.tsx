/* After a booking or a move: is a text wanted, and what the person is told of the server's answer (x-contract-10). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({ notify: vi.fn(), errorMessage: (e: unknown) => String((e as Error)?.message || (e as { error?: string })?.error || e) }));
const ui = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../data/api', () => api);
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), toast: ui.toast }));

import { upsertLocal, clearAll } from '../../data/store';
import { lang } from '../../lib/i18n';
import { notifyCustomer, wantsText, NOTIFY_RETRY_MS, NOTIFY_BUSY_MS } from './notify';

beforeEach(() => {
  lang.value = 'fr';
  ui.toast.mockReset();
  api.notify.mockReset();
  upsertLocal('customers', [{ id: 'C1', first_name: 'Amira', phone: '5145550141', sms_ok: true }], { force: true });
  upsertLocal('jobs', [{ id: 'J1', customer_id: 'C1', day: '2026-11-20', block: 'am', status: 'booked', duration_min: 60, number: 1 }], { force: true });
});
afterEach(() => clearAll());

describe('a text after a booking or a move', () => {
  // the server (notify: quiet only on `false`) and Réglages read a switch the settings do not hold yet as ON; the booking
  // and move screens read it as off, so no text was asked although Réglages showed the switch on
  it('a switch not written in the settings yet is on, as for the server', () => {
    upsertLocal('settings', [{ id: '1', messages: { on: {} } }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(true);
    upsertLocal('settings', [{ id: '1', messages: { on: { booking: false } } }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(false);
    upsertLocal('settings', [{ id: '1', messages: { on: { moved: true } } }], { force: true });
    expect(wantsText('moved', 'J1')).toBe(true);
  });
  it('no number, or a customer who refuses texts: none', () => {
    upsertLocal('customers', [{ id: 'C1', first_name: 'Amira', phone: '5145550141', sms_ok: false }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(false);
    upsertLocal('customers', [{ id: 'C1', first_name: 'Amira', phone: null, sms_ok: true }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(false);
  });
  // the server answers « quiet » when the customer refuses texts or the kind is switched off: before, the person got the
  // red « Le texto n'est pas parti. » with no reason
  it('« quiet » is said calmly, not as a failure', async () => {
    api.notify.mockResolvedValue({ ok: false, status: 'quiet' });
    await notifyCustomer('booking', 'J1');
    expect(ui.toast).toHaveBeenCalledTimes(1);
    expect(ui.toast.mock.calls[0][0]).toBe('Pas de texto : ce client ou ce type de texto est désactivé.');
    expect(ui.toast.mock.calls[0][1]?.kind).toBeUndefined();
  });
  it('sent, failed', async () => {
    api.notify.mockResolvedValue({ ok: true, status: 'sent' });
    await notifyCustomer('booking', 'J1');
    expect(ui.toast.mock.calls.at(-1)).toEqual(['Texto de confirmation envoyé', { kind: 'ok' }]);
    api.notify.mockRejectedValue(new Error('boom'));
    await notifyCustomer('moved', 'J1');
    expect(ui.toast.mock.calls.at(-1)).toEqual(['Le texto n’est pas parti. boom', { kind: 'bad' }]);
  });
});

describe('one send = one id (R27): a lost answer never texts the customer twice', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  afterEach(() => { vi.useRealTimers(); });
  it('each send carries its own id; two sends, two ids', async () => {
    api.notify.mockResolvedValue({ ok: true, status: 'sent' });
    await notifyCustomer('booking', 'J1');
    await notifyCustomer('moved', 'J1');
    expect(api.notify).toHaveBeenCalledTimes(2);
    const [a, b] = api.notify.mock.calls.map((c) => (c[2] as { op: string }).op);
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
    expect(api.notify.mock.calls[0].slice(0, 2)).toEqual(['booking', 'J1']);
  });
  it('the answer lost on a weak signal: asked once more with the SAME id, and the server’s answer is said', async () => {
    vi.useFakeTimers();
    api.notify.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true, status: 'sent' });
    const done = notifyCustomer('booking', 'J1');
    await vi.advanceTimersByTimeAsync(NOTIFY_RETRY_MS);
    await done;
    expect(api.notify).toHaveBeenCalledTimes(2);
    expect(api.notify.mock.calls[1][2]).toEqual(api.notify.mock.calls[0][2]);
    expect(ui.toast.mock.calls).toEqual([['Texto de confirmation envoyé', { kind: 'ok' }]]);
  });
  it('asked again only once; a refusal or an answer of the server is never asked again', async () => {
    vi.useFakeTimers();
    api.notify.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'timeout' }));
    const done = notifyCustomer('booking', 'J1');
    await vi.advanceTimersByTimeAsync(NOTIFY_RETRY_MS);
    await done;
    expect(api.notify).toHaveBeenCalledTimes(2);
    expect(ui.toast.mock.calls.at(-1)?.[1]).toEqual({ kind: 'bad' });
    api.notify.mockReset().mockRejectedValue(new Error('boom'));
    await notifyCustomer('booking', 'J1');
    expect(api.notify).toHaveBeenCalledTimes(1);
    api.notify.mockReset().mockResolvedValue({ ok: false, status: 'error', error: 'x' });
    await notifyCustomer('booking', 'J1');
    expect(api.notify).toHaveBeenCalledTimes(1);
  });
  // moment-pickers-r2-1: after a timeout the first send may still be running on the server (a slow text provider); the
  // try at about 42 s is answered « busy » (409) after the server's 6 s wait. Before, the person read « Le texto n'est
  // pas parti. » although the customer may already have the text
  const BUSY = { ok: false, code: 'busy', error: 'Ce texto est déjà en train de partir. Réessaie dans un instant.' };
  it('« busy » after a lost answer: the same id asked once more a few seconds later, and its answer is said', async () => {
    vi.useFakeTimers();
    api.notify.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'timeout' })).mockResolvedValueOnce(BUSY).mockResolvedValueOnce({ ok: true, status: 'sent' });
    const done = notifyCustomer('booking', 'J1');
    await vi.advanceTimersByTimeAsync(NOTIFY_RETRY_MS);
    expect(api.notify).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(NOTIFY_BUSY_MS);
    await done;
    expect(api.notify).toHaveBeenCalledTimes(3);
    expect(new Set(api.notify.mock.calls.map((c) => (c[2] as { op: string }).op)).size).toBe(1);
    expect(ui.toast.mock.calls).toEqual([['Texto de confirmation envoyé', { kind: 'ok' }]]);
  });
  it('still « busy »: not known yet, said calmly, never « n’est pas parti »; asked no more', async () => {
    vi.useFakeTimers();
    api.notify.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'timeout' })).mockResolvedValue(BUSY);
    const done = notifyCustomer('booking', 'J1');
    await vi.advanceTimersByTimeAsync(NOTIFY_RETRY_MS + NOTIFY_BUSY_MS);
    await done;
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.notify).toHaveBeenCalledTimes(3);
    expect(ui.toast).toHaveBeenCalledTimes(1);
    const [words, o] = ui.toast.mock.calls[0];
    expect(words).toBe(BUSY.error);
    expect(words).not.toContain('pas parti');
    expect(o?.kind).toBeUndefined();
  });
});

// R66: the « texto à envoyer » sheet brought its bubble only through booking.css, which the shell loads at start for
// the call banner; once that line goes, a sheet opened on the agenda (no picker loaded) lost its bubble
describe('the bubble of the « texto à envoyer » sheet has its own stylesheet (R66)', () => {
  it('notify.tsx loads notify.css, whose rule is the very one of booking.css (no change of look)', async () => {
    // the test runner empties CSS imports: the files are read from the disk
    const disk = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (p: URL, enc: 'utf8') => string };
    const here = import.meta.url.replace(/[^/]*$/, '');
    const read = (name: string) => disk.readFileSync(new URL(here + name), 'utf8');
    const rule = (css: string) => /\.sms-bubble\s*\{[^}]*\}/.exec(css)?.[0].replace(/\s+/g, ' ');
    expect(read('notify.tsx')).toContain("import './notify.css';");
    const own = rule(read('notify.css'));
    expect(own).toContain('border-radius: 18px 18px 18px 6px');
    expect(own).toBe(rule(read('booking.css')));
  });
});
