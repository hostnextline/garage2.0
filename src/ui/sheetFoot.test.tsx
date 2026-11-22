/* The answers of a sheet never leave the screen (« exact move » integration, 2026-11-21: on an iPhone the question « Déplacer
   Chloe à 15 h 30 met Denis en retard » showed « Choisir une autre heure » and « Déplacer quand même » side by side, and the
   second one was cut at the right edge: a button's words never wrap, `flex: 1` cannot shrink them). The footer of a sheet
   now puts its buttons on two lines when they do not fit on one; when they fit, nothing changes (each line still shares
   its width). jsdom draws nothing, so the rule is read from the kit's own stylesheet, as the browser applies it. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { AskHost, ask } from './ask';
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

/** the declarations of the stylesheet's rule for exactly that selector (all of them, in order) */
function ruleOf(selector: string): string {
  const found: string[] = [];
  for (const r of Array.from(style.sheet!.cssRules)) if (r instanceof CSSStyleRule && r.selectorText === selector) found.push(r.style.cssText);
  return found.join(' ');
}

describe('a sheet’s answers stay on the screen of a phone', () => {
  it('the question of a late customer: its two long answers are in a footer that may go on two lines', async () => {
    await act(() => { render(<AskHost />, root); });
    void ask({ title: 'Déplacer Chloe à 15 h 30 met Denis en retard', text: 'Denis : vers 16 h 31, 31 min après sa plage (12 h à 16 h).', ok: 'Déplacer quand même', cancel: 'Choisir une autre heure', danger: true });
    await act(async () => { await Promise.resolve(); });
    const ok = document.querySelector('[data-testid="ask-ok"]');
    expect(ok?.textContent).toContain('Déplacer quand même');
    const foot = ok!.closest('.sheet-foot');
    expect(foot).not.toBeNull();
    // a button's words never wrap (the kit's rule): only the footer can make room, by a second line
    expect(ruleOf('.btn')).toMatch(/white-space: nowrap/);
    expect(ruleOf('.sheet-foot')).toMatch(/flex-wrap: wrap/);
    // and the buttons still share a line when they fit (flex: 1, as before)
    expect(ruleOf('.sheet-foot .btn')).toMatch(/flex: 1/);
  });
});
