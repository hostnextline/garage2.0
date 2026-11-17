/* « Pas encore à jour » above every screen (R136): when the first download of the session could not read some lists
   (an empty garage must not look real). Said only once it lasts (a pull failing for a moment as the signal comes back
   is not), never while the phone says it is offline (the chip says « Hors ligne »); « Réessayer » reads them again. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const pulls: number[] = [];
vi.mock('../data/sync', async (orig) => ({ ...(await orig<typeof import('../data/sync')>()), pullAll: async () => { pulls.push(1); } }));
import { ShellBanners, NOT_UP_TO_DATE_MS } from './ShellBanners';
import { net } from '../data/sync';
import { browserOnline } from '../platform/media';
import { lang } from '../lib/i18n';

let root: HTMLDivElement;
const START = net.value;
beforeEach(() => { vi.useFakeTimers(); lang.value = 'fr'; pulls.length = 0; root = document.createElement('div'); document.body.appendChild(root); });
afterEach(async () => { await act(() => { render(null, root); }); root.remove(); net.value = START; browserOnline.value = true; vi.useRealTimers(); });
const banner = () => root.querySelector('[data-testid="pull-banner"]');
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('« Pas encore à jour »', () => {
  it('lists unread for a while: the banner, and « Réessayer » reads them again', async () => {
    await act(() => { render(<ShellBanners />, root); });
    await act(() => { net.value = { ...START, ready: true, firstPull: 'failed' }; });
    expect(banner()).toBeNull();
    await wait(NOT_UP_TO_DATE_MS + 10);
    expect(banner()?.textContent).toContain('Pas encore à jour : certaines listes n’ont pas pu être lues.');
    await act(async () => { (banner()!.querySelector('button') as HTMLButtonElement).click(); });
    expect(pulls).toHaveLength(1);
    await act(() => { net.value = { ...START, ready: true, firstPull: 'ok' }; });
    expect(banner()).toBeNull();
  });
  it('a failure that ends quickly (the signal coming back) is never shown', async () => {
    await act(() => { render(<ShellBanners />, root); });
    await act(() => { net.value = { ...START, ready: true, firstPull: 'failed' }; });
    await wait(1000);
    await act(() => { net.value = { ...START, ready: true, firstPull: 'ok' }; });
    await wait(NOT_UP_TO_DATE_MS + 10);
    expect(banner()).toBeNull();
  });
  it('session lost: only « Reconnecte-toi » (one cause, one banner: « Réessayer » could not read the lists)', async () => {
    await act(() => { render(<ShellBanners />, root); });
    await act(() => { net.value = { ...START, ready: true, firstPull: 'failed', session: 'lost' }; });
    await wait(NOT_UP_TO_DATE_MS + 10);
    expect(root.querySelector('[data-testid="session-banner"]')).not.toBeNull();
    expect(banner()).toBeNull();
    // signed in again but some lists still unread: said again only once it lasts
    await act(() => { net.value = { ...START, ready: true, firstPull: 'failed', session: 'ok' }; });
    expect(root.querySelector('[data-testid="session-banner"]')).toBeNull();
    expect(banner()).toBeNull();
    await wait(NOT_UP_TO_DATE_MS + 10);
    expect(banner()).not.toBeNull();
  });
  it('a session being renewed (« expired », no banner of its own): the lists unread are still said', async () => {
    await act(() => { render(<ShellBanners />, root); });
    await act(() => { net.value = { ...START, ready: true, firstPull: 'failed', session: 'expired' }; });
    await wait(NOT_UP_TO_DATE_MS + 10);
    expect(root.querySelector('[data-testid="session-banner"]')).toBeNull();
    expect(banner()).not.toBeNull();
  });
  it('offline: nothing (the chip says « Hors ligne »)', async () => {
    browserOnline.value = false;
    await act(() => { render(<ShellBanners />, root); });
    await act(() => { net.value = { ...START, ready: true, firstPull: 'failed' }; });
    await wait(NOT_UP_TO_DATE_MS + 10);
    expect(banner()).toBeNull();
  });
});
