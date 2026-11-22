/* « No signal » (e2e « Failed to fetch dynamically imported module »): a page whose code is not on the phone yet,
   asked with no signal, says so in the person's words and reports nothing (it is not a fault); the signal back, it is
   asked again, then « Réessayer » (a browser may remember the failed download). A real failure online keeps its words
   (« Cette page ne s'ouvre pas », Recharger) and is reported. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ComponentType } from 'preact';
import type { ScreenProps } from '../platform/router';

const state: { fail: number; loaded?: ComponentType<ScreenProps> } = { fail: 0 };
vi.mock('./routes', () => ({
  findRoute: (path: string) => (path === '/agenda' ? { def: { pattern: '/agenda/:day?', load: async () => ({ default: () => null }) }, params: {} } : null),
  loadedScreen: () => state.loaded,
  loadScreen: async () => {
    if (state.fail > 0) { state.fail--; throw new TypeError('Failed to fetch dynamically imported module: http://x/assets/AgendaScreen-x.js'); }
    state.loaded = () => <div data-testid="agenda-screen">Agenda</div>;
    return state.loaded;
  }
}));
import { ScreenHost, loadFailure, RETRY_MS } from './ScreenHost';
import { browserOnline } from '../platform/media';
import { route, parseHash } from '../platform/router';
import { recentErrors, resetReports } from '../platform/report';
import { lang } from '../lib/i18n';

let root: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  lang.value = 'fr'; state.fail = 0; state.loaded = undefined; resetReports();
  route.value = parseHash('#/agenda');
  root = document.createElement('div'); document.body.appendChild(root);
});
afterEach(async () => { await act(() => { render(null, root); }); root.remove(); browserOnline.value = true; vi.useRealTimers(); });
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('a page whose code did not come', () => {
  it('the three cases', () => {
    expect(loadFailure(true, false)).toBe('offline');
    expect(loadFailure(false, false)).toBe('offline');
    expect(loadFailure(true, true)).toBe('back');
    expect(loadFailure(false, true)).toBe('failed');
  });
  it('no signal: « Pas de réseau … », nothing reported; the signal back: asked again and the page opens', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    browserOnline.value = false;
    state.fail = 2;
    await act(() => { render(<ScreenHost />, root); });
    await settle(RETRY_MS + 10);
    expect(root.textContent).toContain('Pas de réseau : cette page s’ouvrira quand le signal reviendra.');
    expect(recentErrors()).toHaveLength(0);
    expect(err).not.toHaveBeenCalled();
    await act(() => { browserOnline.value = true; });
    await settle(10);
    expect(root.querySelector('[data-testid="agenda-screen"]')).not.toBeNull();
    err.mockRestore();
  });
  it('the signal back but the browser remembers the failure: « Réessayer » reloads the app', async () => {
    browserOnline.value = false;
    state.fail = 3;
    await act(() => { render(<ScreenHost />, root); });
    await settle(RETRY_MS + 10);
    await act(() => { browserOnline.value = true; });
    await settle(10);
    expect(root.textContent).toContain('Le signal est revenu : touche « Réessayer » pour ouvrir cette page.');
    expect(root.querySelector('button')?.textContent).toBe('Réessayer');
    expect(recentErrors()).toHaveLength(0);
  });
  it('online, a real failure: the words of before, « Recharger », and it is reported', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.fail = 2;
    await act(() => { render(<ScreenHost />, root); });
    await settle(RETRY_MS + 10);
    expect(root.textContent).toContain('Cette page ne s’ouvre pas. L’app a peut-être été mise à jour.');
    expect(root.querySelector('button')?.textContent).toBe('Recharger');
    expect(recentErrors().map((r) => r.kind)).toEqual(['chunk']);
  });
  it('in English', async () => {
    lang.value = 'en';
    browserOnline.value = false;
    state.fail = 2;
    await act(() => { render(<ScreenHost />, root); });
    await settle(RETRY_MS + 10);
    expect(root.textContent).toContain('No signal: this page will open when the signal is back.');
  });
});
