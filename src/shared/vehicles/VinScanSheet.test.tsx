/* « Scanner le NIV » on screen, the camera absent and the photo reader pretended: a doubtful reading is never given
   back (and so never saved) before « Garder ce NIV » (customers-b-01); a reader that did not load says so, and a photo
   reading that never ends does not keep the sheet on « Lecture… » (customers-b-09, b-16). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const scan = vi.hoisted(() => ({ result: null as null | (() => Promise<unknown>), cancel: vi.fn() }));
vi.mock('./vinScan', async (orig) => ({
  ...(await orig<typeof import('./vinScan')>()),
  hasCamera: () => false,
  readVinPhoto: () => ({ result: scan.result!(), cancel: scan.cancel })
}));

import { lang } from '../../lib/i18n';
import { ReaderUnavailable } from './vinScan';
import { VinScanSheet } from './VinScanSheet';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const photo = async () => {
  const input = q('vin-photo-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'vin.jpg', { type: 'image/jpeg' })], configurable: true });
  await act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait();
};

let given: string[] = [];
beforeEach(() => { lang.value = 'fr'; given = []; scan.cancel.mockReset(); });
afterEach(() => { act(() => render(null, box)); });
const draw = () => act(() => render(<VinScanSheet onClose={() => undefined} onVin={(v) => given.push(v)} />, box));

describe('« Scanner le NIV »', () => {
  it('a sure reading is given back at once', async () => {
    scan.result = async () => ({ vin: '1HGCM82633A004352', ok: true });
    await draw();
    await photo();
    expect(given).toEqual(['1HGCM82633A004352']);
  });
  it('a repaired reading is shown, and given back only when « Garder ce NIV » is tapped', async () => {
    scan.result = async () => ({ vin: '1HGCM82633A004352', ok: false, why: 'repaired' });
    await draw();
    await photo();
    expect(given).toEqual([]);
    expect(q('vin-doubt')!.textContent).toContain('NIV lu : 1HGCM82633A004352');
    expect(q('vin-doubt')!.textContent).toContain('Lecture incertaine');
    await act(() => { q('vin-doubt-keep')!.click(); });
    expect(given).toEqual(['1HGCM82633A004352']);
  });
  it('a reader that could not load says so, not « no VIN in the photo »', async () => {
    scan.result = async () => { throw new ReaderUnavailable(new Error('cdn')); };
    await draw();
    await photo();
    expect(q('vin-reader-failed')).not.toBeNull();
    expect(q('vin-photo-none')).toBeNull();
    expect((q('vin-photo') as HTMLButtonElement).disabled).toBe(false);
  });
  it('nothing read: the photo can be taken again', async () => {
    scan.result = async () => null;
    await draw();
    await photo();
    expect(q('vin-photo-none')).not.toBeNull();
    expect(q('vin-photo-reading')).toBeNull();
    expect((q('vin-photo') as HTMLButtonElement).disabled).toBe(false);
  });
  it('a reading still going when the sheet closes is stopped', async () => {
    scan.result = () => new Promise(() => undefined);
    await draw();
    await photo();
    expect(q('vin-photo-reading')).not.toBeNull();
    await act(() => render(null, box));
    expect(scan.cancel).toHaveBeenCalled();
  });
});
