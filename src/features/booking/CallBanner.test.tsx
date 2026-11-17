/* The incoming-call banner over a booking half typed (x-reactivity-19): « Ouvrir » asks before the form is replaced;
   with nothing typed it opens the call at once, as before. The server is pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls = vi.hoisted(() => ({ rows: [] as { id: string; phone: string; name: string | null; at: string }[] }));
const chain = vi.hoisted(() => {
  const q = { select: () => q, gte: () => q, order: () => q, limit: async () => ({ data: calls.rows, error: null }) };
  return q;
});
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
