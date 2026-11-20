/* « Synchronisation », the changes the server refused (S01, argent-app-03): « Retirer » on a refused PAYMENT asks first
   (the customer may have handed the cash over: the entry is the only trace of it); any other refused change goes in one
   tap, as before. Nothing is removed until the person says so. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  h.list = [payment, note]; h.dismissed = [];
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
