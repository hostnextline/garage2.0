/* The receipt viewer (review TR-9): the signal coming back asks again only when the picture was missing for lack of
   signal, and the full-size address outlives the viewer long enough for a tab opened just before. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const asked: string[] = [];
let answer: () => Promise<string | null> = async () => 'data:image/jpeg;base64,/9j/';
vi.mock('./receipts', () => ({
  receiptImage: (id: string) => { asked.push(id); return answer(); },
  openableUrl: (u: string | null) => (u ? 'blob:large' : null)
}));
import { ReceiptViewer, LARGE_URL_MS } from './ReceiptViewer';
import { net } from '../../data/sync';
import { lang } from '../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const show = (open: boolean) => act(() => { render(<ReceiptViewer open={open} onClose={() => {}} id="r1" />, box); });
const setOnline = (online: boolean) => act(() => { net.value = { ...net.value, online }; });

beforeEach(() => {
  lang.value = 'fr'; asked.length = 0;
  answer = async () => 'data:image/jpeg;base64,/9j/';
  net.value = { ...net.value, online: true };
});
afterEach(async () => { await act(() => { render(null, box); }); vi.useRealTimers(); });

describe('ReceiptViewer', () => {
  it('a picture already shown is not asked again when the signal goes and comes back', async () => {
    await show(true);
    await flush();
    expect(asked).toEqual(['r1']);
    expect(document.querySelector('.tre-receipt-img')).not.toBeNull();
    await setOnline(false);
    await setOnline(true);
    await flush();
    expect(asked).toEqual(['r1']);
    expect(document.querySelector('.tre-receipt-img')).not.toBeNull();
  });
  it('a picture missing for lack of signal is asked again when the signal comes back', async () => {
    answer = async () => { throw Object.assign(new Error('offline'), { code: 'timeout' }); };
    await setOnline(false);
    await show(true);
    await flush();
    expect(asked.length).toBe(1);
    answer = async () => 'data:image/jpeg;base64,/9j/';
    await setOnline(true);
    await flush();
    expect(asked.length).toBe(2);
    expect(document.querySelector('.tre-receipt-img')).not.toBeNull();
  });
  it('closing the viewer frees the full-size address later, not at once', async () => {
    const revoked: string[] = [];
    const orig = URL.revokeObjectURL;
    URL.revokeObjectURL = ((u: string) => { revoked.push(u); }) as typeof URL.revokeObjectURL;
    try {
      vi.useFakeTimers();
      await show(true);
      await flush();
      await show(false);
      expect(revoked).toEqual([]);
      await act(() => { vi.advanceTimersByTime(LARGE_URL_MS); });
      expect(revoked).toEqual(['blob:large']);
    } finally { URL.revokeObjectURL = orig; }
  });
});
