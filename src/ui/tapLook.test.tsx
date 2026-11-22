/* The tap guard is invisible (fluidite-01): during its pauses (the cool-down after an action, the answers of a question
   just shown, an armed confirm waiting) a kit button keeps exactly its look. Live never faded them; only a disabled
   button fades. The pauses stay marked aria-disabled, which a test robot waits for. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Button, IconButton, BigStep } from './Button';
import { tapPausesForTests } from './tapGuard';

// the test runner empties CSS imports: the kit's stylesheet is read from the disk and put in the page
const disk = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (p: URL, enc: 'utf8') => string };
const css = disk.readFileSync(new URL(import.meta.url.replace(/[^/]*$/, '') + 'styles/components.css'), 'utf8');

let root: HTMLDivElement;
let style: HTMLStyleElement;
beforeAll(() => { tapPausesForTests(true); style = document.createElement('style'); style.textContent = css; document.head.appendChild(style); });
afterAll(() => { tapPausesForTests(false); style.remove(); });
beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root); });
afterEach(async () => { await act(() => { render(null, root); }); root.remove(); });

const look = (el: Element) => { const s = getComputedStyle(el); return { opacity: s.opacity, cursor: s.cursor }; };
const faded = { opacity: '0.5', cursor: 'not-allowed' };
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); await Promise.resolve(); });

describe('the tap guard’s pauses change nothing on screen', () => {
  it('the stylesheet does fade a disabled button (so this test can see a fade)', async () => {
    await act(() => { render(<Button disabled>Enregistrer</Button>, root); });
    expect(look(root.querySelector('button')!)).toEqual(faded);
  });
  it('after an action, the cool-down: taps wait (aria-disabled), the button looks the same', async () => {
    let done: () => void = () => undefined;
    await act(() => { render(<Button variant="primary" onClick={() => new Promise<void>((r) => { done = r; })}>Enregistrer</Button>, root); });
    const b = root.querySelector('button')!;
    const before = { ...look(b), cls: b.className };
    await click(b);
    await act(async () => { done(); await new Promise((r) => setTimeout(r, 0)); });
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.hasAttribute('data-tap-wait')).toBe(true);
    expect({ ...look(b), cls: b.className }).toEqual(before);
    expect(look(b)).not.toEqual(faded);
  });
  it('the answers of a question just shown (hold): waiting, not faded', async () => {
    await act(() => { render(<><Button hold={400}>Annuler</Button><Button hold={400} variant="danger">Oui</Button></>, root); });
    for (const b of root.querySelectorAll('button')) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(look(b)).not.toEqual(faded);
      expect(look(b).opacity).not.toBe('0.5');
    }
  });
  it('an armed confirm: red with its question, as on live, never faded while it waits', async () => {
    await act(() => { render(<Button confirm="Toucher encore pour retirer">Retirer</Button>, root); });
    const b = root.querySelector('button')!;
    await click(b);
    expect(b.className).toContain('btn-danger');
    expect(b.className).toContain('is-armed');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(look(b).opacity).not.toBe('0.5');
    expect(look(b).cursor).not.toBe('not-allowed');
  });
  it('IconButton and BigStep: the same marks, no fade', async () => {
    await act(() => { render(<><IconButton icon={<span />} label="Retirer" confirm="Sûr ?" /><BigStep icon={<span />} label="Je pars" confirm="Toucher encore" /></>, root); });
    for (const b of root.querySelectorAll('button')) {
      await click(b);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(look(b).opacity).not.toBe('0.5');
    }
  });
});
