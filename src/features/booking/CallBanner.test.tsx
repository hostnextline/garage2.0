/* The incoming-call banner over a booking half typed (x-reactivity-19): « Ouvrir » asks before the form is replaced;
   with nothing typed it opens the call at once, as before. The server is pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls = vi.hoisted(() => ({ rows: [] as { id: string; phone: string; name: string | null; at: string }[], since: [] as string[] }));
const chain = vi.hoisted(() => {
  const q = { select: () => q, gte: (_c: string, v: string) => { calls.since.push(v); return q; }, order: () => q, limit: async () => ({ data: calls.rows, error: null }) };
  return q;
});
// the server's clock as the data layer estimates it (by default: the computer's)
const clock = vi.hoisted(() => ({ ahead: 0 }));
vi.mock('../../data/clock', async (orig) => ({ ...(await orig<typeof import('../../data/clock')>()), serverNow: () => Date.now() - clock.ahead }));
vi.mock('../../data/auth', async (orig) => ({
  ...(await orig<typeof import('../../data/auth')>()),
  sb: { from: () => chain, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: async () => undefined }
}));
vi.mock('../../services/bubbles', async (orig) => ({ ...(await orig<typeof import('../../services/bubbles')>()), callsOn: () => true }));
const ui = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), ask: ui.ask }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('../../platform/router', async (orig) => ({ ...(await orig<typeof import('../../platform/router')>()), navigate: nav.navigate }));

import { CallHost } from './CallBanner';
import { bookingTyped } from './screen';
import { lang } from '../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

beforeEach(async () => {
  lang.value = 'fr';
  clock.ahead = 0;
  calls.since = [];
  calls.rows = [{ id: 'k-1', phone: '5145550100', name: 'Mario', at: new Date().toISOString() }];
  ui.ask.mockReset();
  nav.navigate.mockReset();
  bookingTyped.value = false;
  await act(() => render(<CallHost />, box));
  await wait();
});
afterEach(() => { act(() => render(null, box)); bookingTyped.value = false; });

describe('« Appel entrant » over a booking half typed (x-reactivity-19)', () => {
  it('nothing typed: « Ouvrir » opens the call at once (as before)', async () => {
    expect(q('call-banner')).toBeTruthy();
    await act(async () => { q('call-banner-open')!.click(); });
    await wait();
    expect(ui.ask).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/call\?/));
    expect(q('call-banner')).toBeNull();
  });
  it('a booking typed: asked first; « Rester ici » keeps the form and the banner', async () => {
    bookingTyped.value = true;
    ui.ask.mockResolvedValue(false);
    await act(async () => { q('call-banner-open')!.click(); });
    await wait();
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(ui.ask.mock.calls[0][0]).toMatchObject({ title: 'Quitter la réservation en cours ?', ok: 'Ouvrir l’appel', cancel: 'Rester ici' });
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(q('call-banner')).toBeTruthy();
  });
  it('a booking typed: « Ouvrir l’appel » opens it', async () => {
    bookingTyped.value = true;
    ui.ask.mockResolvedValue(true);
    await act(async () => { q('call-banner-open')!.click(); });
    await wait();
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(q('call-banner')).toBeNull();
  });
});

describe('a computer whose clock is a few minutes ahead (x-time-19, booking-a-20)', () => {
  it('a call of 30 s ago on the server’s clock is shown, and asked from the server’s time', async () => {
    act(() => render(null, box));
    clock.ahead = 5 * 60 * 1000;
    calls.since = [];
    calls.rows = [{ id: 'k-2', phone: '5145550111', name: 'Julie', at: new Date(Date.now() - clock.ahead - 30_000).toISOString() }];
    await act(() => render(<CallHost />, box));
    await wait();
    expect(q('call-banner')).toBeTruthy();
    // asked from 3 minutes before the server's now, not the computer's (which would ask from 2 minutes in the future)
    const since = Date.parse(calls.since[0]);
    expect(Math.abs(since - (Date.now() - clock.ahead - 3 * 60 * 1000))).toBeLessThan(2000);
  });
});
