/* The autosave of the draft invoice and the estimate on a weak signal: the answer to an older save must never put the
   older text back on screen (the next keystroke would then be saved over the newer one). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useDraft, type Draft } from './useDraft';

const box = document.createElement('div');
document.body.appendChild(box);
let d: Draft<string>;
let saves: string[] = [];
let bases: string[] = [];
function H(p: { server: string; busy?: boolean; offline?: boolean; fail?: boolean }) {
  d = useDraft<string>(p.server, (v) => v, async (v, base) => { saves.push(v); bases.push(base); if (p.fail) throw new Error('refusé'); }, { busy: p.busy, offline: p.offline, delay: 10 });
  return <span>{d.value}</span>;
}
const draw = (p: { server: string; busy?: boolean; offline?: boolean; fail?: boolean }) => act(() => render(<H {...p} />, box));
const wait = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
const type = async (v: string) => { act(() => d.change(v)); await wait(20); };

beforeEach(() => { vi.useFakeTimers(); saves = []; bases = []; });
afterEach(() => { act(() => render(null, box)); vi.useRealTimers(); });

describe('a form saved by itself', () => {
  it('the answer to an older save while a newer one waits: the newer text stays', async () => {
    draw({ server: 'A' });
    await type('AB');
    await type('ABC');
    expect(saves).toEqual(['AB', 'ABC']);
    // the answer to « AB » lands while « ABC » still waits in the outbox
    draw({ server: 'AB', busy: true });
    await wait(5000);
    expect(d.value).toBe('ABC');
    expect(box.textContent).toBe('ABC');
    // a keystroke now is built on the newer text, not the older one
    await type('ABCD');
    expect(saves.at(-1)).toBe('ABCD');
    // its answer lands, nothing waits: it is already on screen
    draw({ server: 'ABCD', busy: false });
    await wait(2000);
    expect(d.value).toBe('ABCD');
    expect(d.state).toBe('saved');
  });
  it('a save refused (nothing waits any more, the server kept the older text): the server version comes back', async () => {
    draw({ server: 'A' });
    await type('AB');
    draw({ server: 'A', busy: false });
    await wait(2000);
    expect(d.value).toBe('A');
  });
  it('a change from elsewhere (another phone) with nothing waiting here is taken', async () => {
    draw({ server: 'A' });
    draw({ server: 'X' });
    await wait(10);
    expect(d.value).toBe('X');
  });
  it('nothing is taken from the server while a change typed here is not sent yet', async () => {
    draw({ server: 'A' });
    act(() => d.change('AB'));
    draw({ server: 'X' });
    expect(d.value).toBe('AB');
    expect(d.state).toBe('waiting');
  });
  it('back to what was last saved (a price field left without a change): nothing is sent', async () => {
    draw({ server: 'A' });
    await type('A');
    act(() => d.change('AB'));
    act(() => d.change('A'));
    await wait(20);
    expect(saves).toEqual([]);
    expect(d.state).toBe('saved');
  });
  it('a refused save says « Pas enregistré », not « Enregistré »; kept on the phone says so', async () => {
    draw({ server: 'A', fail: true });
    await type('AB');
    expect(d.state).toBe('failed');
    draw({ server: 'A', busy: true, offline: true });
    await type('ABC');
    expect(d.state).toBe('kept');
  });
  it('a save that throws (refused at once): the text typed stays with « Pas enregistré », the next change sends it again (review inv-r7)', async () => {
    draw({ server: 'A', fail: true });
    await type('AB');
    expect(d.state).toBe('failed');
    // the settle time passes: the server's older version is not put over it, and it does not say « Enregistré »
    await wait(5000);
    draw({ server: 'A', fail: true });
    await wait(2000);
    expect(d.value).toBe('AB');
    expect(d.state).toBe('failed');
    // the next change is built on what the server has, so the refused text goes with it
    draw({ server: 'A' });
    await type('ABC');
    expect(saves.at(-1)).toBe('ABC');
    expect(bases.at(-1)).toBe('A');
    expect(d.state).toBe('saved');
    // saved: a change from elsewhere is taken again
    draw({ server: 'ABC' });
    await wait(2000);
    draw({ server: 'X' });
    await wait(10);
    expect(d.value).toBe('X');
  });
  it('flush waits for the saves already on their way, in order', async () => {
    draw({ server: 'A' });
    act(() => d.change('AB'));
    await act(async () => { await d.flush(); });
    act(() => d.change('ABC'));
    await act(async () => { await d.flush(); });
    expect(saves).toEqual(['AB', 'ABC']);
  });
});
