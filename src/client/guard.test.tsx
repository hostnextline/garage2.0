/* A screen that throws while drawing: the customer gets words, « Réessayer » and whom to call (client-page-28). */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Guard } from './guard';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
afterEach(() => { act(() => render(null, box)); location.hash = ''; localStorage.clear(); vi.restoreAllMocks(); });
function Boom(): null { throw new Error('an answer the page did not expect'); }

describe('a screen that throws (client-page-28)', () => {
  it('shows « Un problème est survenu », « Réessayer » and the garage to call, not a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.setItem('his.client.garage', JSON.stringify({ name: 'Mécanique Mobile H.I.S', phone: '438 901-6606' }));
    location.hash = '#t=abcdefghijklmnopqrstuvwxyz&l=fr';
    const retry = vi.fn();
    await act(async () => { render(<Guard onRetry={retry}><Boom /></Guard>, box); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(q('client-error-server')).toBeTruthy();
    expect(box.textContent).toContain('Un problème est survenu');
    expect(box.querySelector('a[href^="tel:"]')).toBeTruthy();
    await act(async () => { q('client-retry')!.click(); });
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('in English when the link says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    location.hash = '#t=abcdefghijklmnopqrstuvwxyz&l=en';
    await act(async () => { render(<Guard><Boom /></Guard>, box); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(box.textContent).toContain('Something went wrong');
  });
  it('draws the page as it is when nothing throws', async () => {
    await act(async () => { render(<Guard><p data-testid="ok">ok</p></Guard>, box); });
    expect(q('ok')).toBeTruthy();
  });
});
