/* « Synchronisation », the changes the server refused (S01, argent-app-03): « Retirer » on a refused PAYMENT asks first
   (the customer may have handed the cash over: the entry is the only trace of it); any other refused change goes in one
   tap, as before. Nothing is removed until the person says so.
   Each refused change is read whole (S30 argent-refusal-cut, S37 e2e-plages-01): its label in full and the server's
   reason as a paragraph, both wrapping, never cut to one line with « … ». The end-to-end proof on a 390 px phone is the
   step « Refusé, lisible » of tests/e2e/argent.test.cjs (skipped until this lands). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { OutboxEntry } from '../data/local';

const h = vi.hoisted(() => ({ list: [] as unknown[], dismissed: [] as [number, boolean | undefined][] }));
vi.mock('../data/sync', async (orig) => ({
  ...(await orig<typeof import('../data/sync')>()),
  outboxList: async () => h.list,
  dismissFailed: async (seq: number, retry?: boolean) => { h.dismissed.push([seq, retry]); h.list = (h.list as OutboxEntry[]).filter((e) => e.seq !== seq); },
  flush: async () => undefined,
  pullAll: async () => undefined
}));
import { SyncSheet, syncOpen, isPaymentEntry } from './sync';
import { AskHost } from '../ui/ask';
import { lang } from '../lib/i18n';

const at = '2026-11-16T15:00:00.000Z';
const payment: OutboxEntry = {
  seq: 7, op: 'op-pay', kind: 'rpc', rpc: 'payment_add', args: { p_invoice: 'inv-1', p_amount_cents: 20000, p_method: 'cash' },
  label: 'Paiement 200,00 $ (Comptant) · Sophie Martin · F-0042', at, tries: 1, state: 'failed', error: 'Ce paiement dépasse ce qui reste à payer.'
};
const note: OutboxEntry = {
  seq: 8, op: 'op-note', kind: 'update', table: 'customers', id: 'c1', values: { notes: 'x' },
  label: 'Fiche de Sophie Martin', at, tries: 1, state: 'failed', error: 'Refusé.'
};
/** a booking kept on the phone, refused once the signal is back (its label as the data layer writes it, S37) */
const booking: OutboxEntry = {
  seq: 9, op: 'op-book', kind: 'rpc', rpc: 'book_job', args: { p_customer: 'c2' },
  label: 'Réservation de Ines Gagnon-Tremblay, samedi 21 novembre, 8 h à 12 h', at, tries: 1, state: 'failed',
  error: 'Cette plage n’est plus libre : choisis-en une autre. Les autres plages du jour sont encore offertes dans la réservation.'
};

let root: HTMLDivElement;
const tick = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
/** the « Retirer » of the refused row whose title holds `words` */
const removeOf = (words: string) => {
  const row = [...document.querySelectorAll('[data-testid="sync-sheet"] .row-item')].find((r) => r.querySelector('.row-title')?.textContent?.includes(words));
  return [...(row?.querySelectorAll('button') || [])].find((b) => b.textContent === 'Retirer') as HTMLButtonElement | undefined;
};
const question = () => [...document.querySelectorAll('[role=dialog] h2')].map((x) => x.textContent).find((x) => x === 'Retirer ce paiement ?') || null;
/** an answer of the question (its buttons ignore taps for 400 ms after it appears, like a person waits) */
const answer = async (ok: boolean) => {
  await tick(450);
  const okBtn = document.querySelector('[data-testid="ask-ok"]') as HTMLButtonElement;
  const btn = ok ? okBtn : [...(okBtn.parentElement?.querySelectorAll('button') || [])].find((b) => b !== okBtn) as HTMLButtonElement;
  await act(async () => { btn.click(); });
  await settle();
};

beforeEach(async () => {
  lang.value = 'fr';
  h.list = [payment, note, booking]; h.dismissed = [];
  root = document.createElement('div'); document.body.appendChild(root);
  syncOpen.value = true;
  await act(() => { render(<><SyncSheet /><AskHost /></>, root); });
  await settle();
});
afterEach(async () => { syncOpen.value = false; await act(() => { render(null, root); }); root.remove(); await settle(); });

describe('« Retirer » a refused change', () => {
  it('a refused payment: « Retirer » asks first, says the customer may have paid; « Annuler » keeps it', async () => {
    await act(async () => { removeOf('Paiement 200,00 $')!.click(); });
    await settle();
    expect(question()).toBe('Retirer ce paiement ?');
    expect(document.body.textContent).toContain('Ce paiement n’a pas été enregistré. Le client a peut-être payé : vérifie avant de retirer.');
    expect(h.dismissed).toEqual([]);
    await answer(false);
    expect(question()).toBeNull();
    expect(h.dismissed).toEqual([]);
    expect(removeOf('Paiement 200,00 $')).toBeTruthy();
  });
  it('a refused payment: « Retirer » in the question takes it off the phone', async () => {
    await act(async () => { removeOf('Paiement 200,00 $')!.click(); });
    await settle();
    expect(document.querySelector('[data-testid="ask-ok"]')?.textContent).toBe('Retirer');
    await answer(true);
    expect(h.dismissed).toEqual([[7, undefined]]);
    expect(removeOf('Paiement 200,00 $')).toBeUndefined();
  });
  it('any other refused change: removed in one tap, no question (as before)', async () => {
    await act(async () => { removeOf('Fiche de Sophie Martin')!.click(); });
    await settle();
    expect(question()).toBeNull();
    expect(document.querySelector('[data-testid="ask-ok"]')).toBeNull();
    expect(h.dismissed).toEqual([[8, undefined]]);
  });
  it('« Réessayer » never asks (the payment is sent again, nothing is lost)', async () => {
    const row = [...document.querySelectorAll('[data-testid="sync-sheet"] .row-item')][0];
    await act(async () => { ([...row.querySelectorAll('button')].find((b) => b.textContent === 'Réessayer') as HTMLButtonElement).click(); });
    await settle();
    expect(question()).toBeNull();
    expect(h.dismissed).toEqual([[7, true]]);
  });
  it('in English too', async () => {
    await act(() => { lang.value = 'en'; });
    await settle();
    await act(async () => { ([...document.querySelectorAll('[data-testid="sync-sheet"] .row-item')][0].querySelectorAll('button')[1] as HTMLButtonElement).click(); });
    await settle();
    expect([...document.querySelectorAll('[role=dialog] h2')].map((x) => x.textContent)).toContain('Remove this payment?');
    expect(document.body.textContent).toContain('This payment was not recorded. The customer may have paid: check before removing it.');
    await answer(false);
    expect(h.dismissed).toEqual([]);
  });
});

describe('which entry is a payment', () => {
  it('payment_add only', () => {
    expect(isPaymentEntry(payment)).toBe(true);
    expect(isPaymentEntry(note)).toBe(false);
    expect(isPaymentEntry({ kind: 'rpc', rpc: 'book_job' })).toBe(false);
    expect(isPaymentEntry({ kind: 'insert', rpc: undefined })).toBe(false);
  });
});

describe('a refused change is read whole (S30, S37)', () => {
  // the test runner empties CSS imports: the kit's and the frame's stylesheets are read from the disk, in the app's order
  let style: HTMLStyleElement;
  beforeAll(async () => {
    const disk = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (p: URL, enc: 'utf8') => string };
    const here = import.meta.url.replace(/[^/]*$/, '');
    style = document.createElement('style');
    style.textContent = ['../ui/styles/components.css', 'shell.css'].map((f) => disk.readFileSync(new URL(here + f), 'utf8')).join('\n');
    document.head.appendChild(style);
  });
  afterAll(() => { style.remove(); });
  const rowOf = (words: string) => [...document.querySelectorAll('[data-testid="sync-sheet"] .row-item')]
    .find((r) => r.querySelector('.row-title')?.textContent?.includes(words)) as HTMLElement;
  /** the element that holds exactly `text` (what a test robot finds by its words) */
  const holder = (row: Element, text: string) => [...row.querySelectorAll('*')].find((el) => el.textContent === text && ![...el.children].some((c) => c.textContent === text));
  const cut = (el: Element) => { const s = getComputedStyle(el); return { whiteSpace: s.whiteSpace === 'nowrap', ellipsis: s.textOverflow === 'ellipsis', hidden: s.overflow === 'hidden' }; };
  const whole = { whiteSpace: false, ellipsis: false, hidden: false };

  it('the stylesheet does cut a plain row to one line (so this test can see a cut)', () => {
    const probe = document.createElement('div');
    probe.innerHTML = '<div class="row-item"><span class="row-main"><span class="row-title">x</span><span class="row-sub">y</span></span></div>';
    document.body.appendChild(probe);
    expect(cut(probe.querySelector('.row-title')!)).toEqual({ whiteSpace: true, ellipsis: true, hidden: true });
    expect(cut(probe.querySelector('.row-sub')!)).toEqual({ whiteSpace: true, ellipsis: true, hidden: true });
    probe.remove();
  });
  it('the reason under the label is a wrapping paragraph, not the one-line sub of a row', () => {
    for (const e of [payment, booking]) {
      const why = holder(rowOf(e.label!), e.error!)!;
      expect(why, e.error!).toBeTruthy();
      expect(why.tagName).toBe('P');
      expect(why.classList.contains('row-sub')).toBe(false);
      expect(cut(why)).toEqual(whole);
    }
  });
  it('the label is printed in full and wraps: whose booking, which day (S37)', () => {
    const title = rowOf('Réservation de Ines').querySelector('.row-title')!;
    expect(title.textContent).toBe(booking.label);
    expect(cut(title)).toEqual(whole);
  });
  it('on a narrow phone the buttons may go under the words (the row wraps)', () => {
    const row = rowOf('Réservation de Ines');
    expect(getComputedStyle(row).flexWrap).toBe('wrap');
    expect([...row.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Réessayer', 'Retirer']);
  });
  it('the changes still waiting keep their one-line rows (nothing else changes)', async () => {
    h.list = [{ ...note, seq: 10, state: 'pending', error: undefined }];
    await act(() => { syncOpen.value = false; });
    await act(() => { syncOpen.value = true; });
    await settle();
    const row = rowOf('Fiche de Sophie Martin');
    expect(row.querySelector('.row-sub')).toBeTruthy();
    expect(row.classList.contains('sync-refused')).toBe(false);
  });
});
