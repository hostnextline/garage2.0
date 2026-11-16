/* The kit's behaviours in jsdom: the sheet (dimmed area, Escape, dismissable), the buttons (double taps, busy, a
   failing action), the error boundary, the escape stack with a « ? » bubble. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { ErrorBoundary } from './ErrorBoundary';
import { Help, bubbleTop } from './Help';
import { toasts } from './toast';
import { recentErrors, resetReports } from '../platform/report';
import { whenHistorySettled } from '../platform/history';
import { ARM_DEAD_MS } from './tapGuard';
import { jobStatusWord, invoiceStatusWord, Totals, Stamp } from './kit';
import { lang } from '../lib/i18n';

let root: HTMLDivElement;
beforeEach(() => { lang.value = 'fr'; root = document.createElement('div'); document.body.appendChild(root); toasts.value = []; resetReports(); });
afterEach(async () => {
  await act(() => { render(null, root); });
  root.remove();
  await new Promise<void>((r) => whenHistorySettled(() => setTimeout(r, 0)));
});
const fire = (el: Element, type: string, init: EventInit = { bubbles: true }) => act(() => { el.dispatchEvent(new Event(type, init)); });
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('Sheet: the dimmed area', () => {
  async function open(dismissable = true) {
    const onClose = vi.fn();
    await act(() => { render(<Sheet open onClose={onClose} title="T" dismissable={dismissable}><input /></Sheet>, root); });
    return { onClose, back: document.querySelector('.sheet-back')!, box: document.querySelector('.sheet')! };
  }
  it('a press alone does not close it (old logic closed on the press: the click then landed under the finger)', async () => {
    const { onClose, back } = await open();
    await fire(back, 'pointerdown');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('a press and a release on it close it once', async () => {
    const { onClose, back } = await open();
    await fire(back, 'pointerdown');
    await click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('a press inside the sheet released on the dimmed area (a text selection) does not close it', async () => {
    const { onClose, back, box } = await open();
    await fire(box, 'pointerdown');
    await click(back);
    expect(onClose).not.toHaveBeenCalled();
  });
  it('dismissable={false}: neither the dimmed area nor Escape close it', async () => {
    const { onClose, back } = await open(false);
    await fire(back, 'pointerdown');
    await click(back);
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
  });
  it('Escape reads dismissable live (old logic kept the value of the first draw)', async () => {
    const onClose = vi.fn();
    let setD: (v: boolean) => void = () => undefined;
    function Host() { const [d, set] = useState(true); setD = set; return <Sheet open onClose={onClose} title="T" dismissable={d} />; }
    await act(() => { render(<Host />, root); });
    await act(() => setD(false));
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
  });
  it('Escape on a « ? » bubble inside a sheet closes the bubble only', async () => {
    const onClose = vi.fn();
    await act(() => { render(<Sheet open onClose={onClose} title="T"><Help text="Explication" /></Sheet>, root); });
    await click(document.querySelector('.help')!);
    expect(document.querySelector('.help-pop')).not.toBeNull();
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('.help-pop')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Button', () => {
  it('two clicks in the same instant run a pending action once', async () => {
    let done: () => void = () => undefined;
    const fn = vi.fn(() => new Promise<void>((r) => { done = r; }));
    await act(() => { render(<Button onClick={fn}>Go</Button>, root); });
    const b = root.querySelector('button')!;
    await act(() => { b.click(); b.click(); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { done(); });
  });
  it('the busy prop blocks taps (old logic only drew a spinner)', async () => {
    const fn = vi.fn();
    await act(() => { render(<Button busy onClick={fn}>Go</Button>, root); });
    await click(root.querySelector('button')!);
    expect(fn).not.toHaveBeenCalled();
  });
  it('confirm: a double tap arms and does nothing; a tap after the dead time acts', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      await act(() => { render(<Button confirm="Toucher encore" onClick={fn}>Supprimer</Button>, root); });
      const b = root.querySelector('button')!;
      await click(b);
      expect(b.textContent).toBe('Toucher encore');
      expect(b.getAttribute('aria-disabled')).toBe('true');
      vi.advanceTimersByTime(150);
      await click(b);
      expect(fn).not.toHaveBeenCalled();
      await act(() => { vi.advanceTimersByTime(ARM_DEAD_MS); });
      expect(b.getAttribute('aria-disabled')).toBeNull();
      await click(b);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('an action that fails without a word is reported and told (old logic swallowed it)', async () => {
    await act(() => { render(<Button onClick={() => Promise.reject(new Error('boom'))}>Go</Button>, root); });
    await click(root.querySelector('button')!);
    await flush();
    expect(toasts.value.some((x) => x.kind === 'bad')).toBe(true);
    expect(recentErrors().map((r) => r.message)).toContain('boom');
  });
  it('hold: the buttons of a question that just appeared ignore taps for a moment', async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      await act(() => { render(<Button hold={400} onClick={fn}>OK</Button>, root); });
      const b = root.querySelector('button')!;
      await click(b);
      expect(fn).not.toHaveBeenCalled();
      await act(() => { vi.advanceTimersByTime(400); });
      await click(b);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

describe('ErrorBoundary', () => {
  function Boom(p: { on: boolean }): null { if (p.on) throw new Error('bad row'); return null; }
  it('a part that throws while mounting shows the message, reported once (old: a blank area)', async () => {
    await act(() => { render(<ErrorBoundary name="screen:/x"><Boom on /></ErrorBoundary>, root); });
    expect(root.querySelector('[data-testid="crash"]')).not.toBeNull();
    expect(root.textContent).toContain('Recharger');
    expect(recentErrors().filter((r) => r.where === 'screen:/x')).toHaveLength(1);
  });
  it('a part that throws on a later draw shows the message, not the stale picture', async () => {
    let set: (v: boolean) => void = () => undefined;
    function Host() { const [on, s] = useState(false); set = s; return <><span id="ok">ok</span><Boom on={on} /></>; }
    await act(() => { render(<ErrorBoundary name="screen:/y"><Host /></ErrorBoundary>, root); });
    expect(root.querySelector('#ok')).not.toBeNull();
    await act(() => set(true));
    expect(root.querySelector('#ok')).toBeNull();
    expect(root.querySelector('[data-testid="crash"]')).not.toBeNull();
  });
  it('another address tries again; a silent boundary draws nothing', async () => {
    await act(() => { render(<ErrorBoundary name="s" resetKey="/a"><Boom on /></ErrorBoundary>, root); });
    expect(root.querySelector('[data-testid="crash"]')).not.toBeNull();
    await act(() => { render(<ErrorBoundary name="s" resetKey="/b"><Boom on={false} /><i id="fine" /></ErrorBoundary>, root); });
    expect(root.querySelector('#fine')).not.toBeNull();
    await act(() => { render(<ErrorBoundary name="host:x" silent><Boom on /></ErrorBoundary>, root); });
    expect(root.innerHTML).toBe('');
  });
});

describe('the « ? » bubble', () => {
  it('goes under the button, above it when the screen has no room below', () => {
    expect(bubbleTop({ btnTop: 100, btnBottom: 120, popH: 100, viewH: 800, scrollY: 0 })).toBe(128);
    expect(bubbleTop({ btnTop: 700, btnBottom: 720, popH: 100, viewH: 800, scrollY: 0 })).toBe(592);
    // no room above either: under, as before
    expect(bubbleTop({ btnTop: 50, btnBottom: 70, popH: 900, viewH: 800, scrollY: 10 })).toBe(88);
  });
});

describe('the kit’s words come from the dictionaries, unchanged', () => {
  it('status words in both languages', () => {
    expect(jobStatusWord('booked', 'fr')).toBe('Réservé');
    expect(jobStatusWord('en_route', 'en')).toBe('On the way');
    expect(jobStatusWord('no_show', 'fr')).toBe('Client absent');
    expect(invoiceStatusWord('partial', 'fr')).toBe('Payée en partie');
    expect(invoiceStatusWord('issued', 'en')).toBe('Unpaid');
  });
  it('the stamp and the totals', async () => {
    await act(() => { render(<><Stamp kind="no_show" /><Totals subtotal={100} tps={5} tvq={10} total={115} paid={50} l="fr" /></>, root); });
    expect(root.textContent).toContain('Absent');
    expect(root.textContent).toContain('Reste à payer');
    await act(() => { render(<Totals subtotal={100} tps={5} tvq={10} total={115} paid={50} l="en" />, root); });
    expect(root.textContent).toContain('Balance');
  });
});
