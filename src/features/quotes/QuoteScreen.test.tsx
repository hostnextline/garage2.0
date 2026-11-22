/* One estimate: a price typed wrong (red) keeps its line at the last good price, so the estimate is neither sent
   (PDF, « Partager », « Marquer comme envoyée ») nor booked while it is red: the customer would get, or the job would
   take, a price that is not the one on screen (review invoices-r2-3). The server and the PDF are pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const api = vi.hoisted(() => ({ saveQuote: vi.fn(async () => undefined) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));
const pdf = vi.hoisted(() => ({ make: vi.fn(async () => 'downloaded' as const) }));
vi.mock('../../shared/invoices/usePdf', () => ({ usePdf: () => ({ make: pdf.make, sheet: null }) }));

import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { toasts } from '../../ui/toast';
import type { Access, Quote } from '../../data/types';
import QuoteScreen from './QuoteScreen';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const quote = { id: 'q-1', number: 12, status: 'open', lang: 'fr', customer_id: null, vehicle_id: null, contact_name: 'Marc', contact_phone: null, vehicle_text: null,
  notes: null, job_id: null, valid_until: null, created_by: 'u-1', created_at: '2026-11-17T14:00:00.000Z', updated_at: '2026-11-17T14:00:00.000Z', deleted_at: null,
  items: [{ description: 'Freins avant', qty: 1, unit_cents: 0, taxable: true, kind: 'service' }] } as unknown as Quote;
const BAD = 'Un prix est mal écrit : corrige le champ en rouge d’abord.';

beforeEach(() => {
  lang.value = 'fr';
  access.value = { id: 'u-1', full_name: 'Hassan', short_name: null, email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null, rights: {} as Access['rights'], trucks: [] };
  replaceLocal('quotes', [quote]);
  vi.clearAllMocks();
});
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; toasts.value = []; location.hash = ''; });

/** a tap on a link-button: was its way to the booking screen stopped? */
const tapLink = (el: HTMLElement) => { const e = new MouseEvent('click', { bubbles: true, cancelable: true }); act(() => { el.dispatchEvent(e); }); return e.defaultPrevented; };

describe('a price typed wrong on an estimate (review invoices-r2-3)', () => {
  it('PDF, « Marquer comme envoyée » and « Réserver » are refused and say why; typed right, they work', async () => {
    act(() => render(<QuoteScreen params={{ id: 'q-1' }} query={new URLSearchParams()} />, box));
    await wait();
    const price = box.querySelector('.inv-line-price input') as HTMLInputElement;
    const type = async (s: string) => { await act(async () => { price.value = s; price.dispatchEvent(new Event('input', { bubbles: true })); }); };
    await type('45,,50');
    await act(async () => { q('quote-pdf')!.click(); });
    await wait();
    expect(pdf.make).not.toHaveBeenCalled();
    expect(toasts.value.map((x) => x.text)).toContain(BAD);
    await act(async () => { q('quote-mark-sent')!.click(); });
    await wait();
    expect(api.saveQuote).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
    expect(tapLink(q('quote-book')!)).toBe(true);
    // typed right: the new price goes out
    await type('45,50');
    await act(async () => { q('quote-pdf')!.click(); });
    await wait();
    expect(pdf.make).toHaveBeenCalledTimes(1);
    expect(tapLink(q('quote-book')!)).toBe(false);
  });
});
