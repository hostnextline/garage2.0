/* The phone's back on a sheet that asks before closing (R57): « back » → the question → « Annuler » keeps the sheet
   open WITH its history step, so the next « back » asks again instead of leaving the screen (old logic: the step was
   gone, the second back left the screen and what was typed). A sheet that closes goes with its step. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { Sheet } from './Sheet';
import { ask, AskHost } from './ask';
import { whenHistorySettled, stackOf, layersOpen } from '../platform/history';
import { lang } from '../lib/i18n';

const settled = () => new Promise<void>((r) => whenHistorySettled(() => setTimeout(r, 0)));
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));
async function calm() { for (let i = 0; i < 6; i++) { await act(async () => { await tick(); await settled(); }); } }
const steps = () => stackOf(history.state).length;
const back = async () => { await act(async () => { history.back(); }); await calm(); };
const question = () => [...document.querySelectorAll('[role=dialog] h2')].map((h) => h.textContent).filter((x) => x === 'Quitter sans enregistrer ?');
const answer = async (ok: boolean) => {
  // the answers of a question just shown ignore taps for 400 ms (ask's hold)
  await act(() => tick(450));
  const btns = [...document.querySelectorAll('[role=dialog] .sheet-foot button')] as HTMLButtonElement[];
  const b = ok ? btns.find((x) => x.dataset.testid === 'ask-ok') : btns.find((x) => x.dataset.testid !== 'ask-ok');
  await act(async () => { b!.click(); });
  await calm();
};

let root: HTMLDivElement;
let closed = 0;
function Host() {
  const [open, setOpen] = useState(true);
  const close = async () => {
    if (!(await ask({ title: 'Quitter sans enregistrer ?', ok: 'Quitter' }))) return;
    closed++;
    setOpen(false);
  };
  return <><Sheet open={open} onClose={() => void close()} title="Le service" data-testid="the-sheet"><input /></Sheet><AskHost /></>;
}

beforeEach(async () => {
  lang.value = 'fr'; closed = 0;
  await calm();
  history.replaceState({ d: 0 }, '', '/#/settings/services');
  root = document.createElement('div'); document.body.appendChild(root);
});
afterEach(async () => { await act(() => { render(null, root); }); root.remove(); await calm(); });

describe('the phone’s back on a sheet that asks first', () => {
  it('back → question → « Annuler »: the sheet stays with its step; the next back asks again', async () => {
    await act(() => { render(<Host />, root); });
    await calm();
    expect(steps()).toBe(1);
    await back();
    expect(question()).toHaveLength(1);
    await answer(false);
    expect(question()).toHaveLength(0);
    expect(document.querySelector('[data-testid="the-sheet"]')).not.toBeNull();
    expect(steps()).toBe(1);
    expect(location.hash).toBe('#/settings/services');
    // the next back asks again (old logic: it left « Services »)
    await back();
    expect(question()).toHaveLength(1);
    expect(closed).toBe(0);
    // « Quitter »: the sheet goes, with its step; nothing is left behind
    await answer(true);
    expect(closed).toBe(1);
    expect(document.querySelector('[data-testid="the-sheet"]')).toBeNull();
    expect(steps()).toBe(0);
    expect(layersOpen.value).toBe(0);
    expect(location.hash).toBe('#/settings/services');
  });
  it('a back on the question itself is « Annuler »: the sheet keeps its step', async () => {
    await act(() => { render(<Host />, root); });
    await calm();
    await back();
    expect(question()).toHaveLength(1);
    await back();
    expect(question()).toHaveLength(0);
    expect(document.querySelector('[data-testid="the-sheet"]')).not.toBeNull();
    expect(steps()).toBe(1);
    expect(closed).toBe(0);
  });
  it('its ✕ → question → « Quitter »: the sheet and the question go with both their steps (old logic left a dead step)', async () => {
    await act(() => { render(<Host />, root); });
    await calm();
    await act(async () => { (document.querySelector('[data-testid="the-sheet"] .sheet-x') as HTMLElement).click(); });
    await calm();
    expect(question()).toHaveLength(1);
    expect(steps()).toBe(2);
    await answer(true);
    expect(closed).toBe(1);
    expect(steps()).toBe(0);
    expect(layersOpen.value).toBe(0);
  });
  it('a plain sheet closed by back goes with its step, once', async () => {
    let n = 0;
    function Plain() { const [open, setOpen] = useState(true); return <Sheet open={open} onClose={() => { n++; setOpen(false); }} title="T"><input /></Sheet>; }
    await act(() => { render(<Plain />, root); });
    await calm();
    expect(steps()).toBe(1);
    await back();
    expect(n).toBe(1);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(steps()).toBe(0);
    expect(layersOpen.value).toBe(0);
  });
});
