/* The invoice panel of a job, drawn with the device's copy: the draft takes the work accepted after it was made,
   « Terminer la facture » asks when billable work is missing, a numbered draft cannot be deleted, a finished invoice
   says the work it does not bill and the money paid too much. The server is pretended. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const api = vi.hoisted(() => ({ invoiceForJob: vi.fn(async () => ({ queued: false, data: { ok: true } })), saveInvoiceDraft: vi.fn(async () => undefined), finishInvoice: vi.fn(async () => ({ queued: false, data: { ok: true, number: 51 } })), updateItem: vi.fn(async () => undefined) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));

import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { toasts } from '../../ui/toast';
import { AskHost } from '../../ui/ask';
import type { Access, Invoice, Job, JobItem } from '../../data/types';
import { InvoicePanel } from './InvoicePanel';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const sheet = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 50) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const draw = async () => { act(() => render(<><InvoicePanel jobId="j-1" /><AskHost /></>, box)); await wait(); };
/** the other button of the question (« Revoir la facture ») */
const askCancel = () => { const ok = sheet('ask-ok'); return ok ? ([...(ok.parentElement?.querySelectorAll('button') || [])].find((b) => b !== ok) as HTMLElement | undefined) || null : null; };
/** a question's buttons ignore taps for 400 ms after it appears (ask.tsx `hold`): wait that out, like a person */
/** the words as read, no-break spaces as plain ones (« 57,49 $ », « : ») */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');
const answer = async (el: HTMLElement | null) => { expect(el).toBeTruthy(); await wait(450); await act(async () => { el!.click(); }); await wait(); };

const made = '2026-11-17T14:00:00.000Z';
const job = { id: 'j-1', number: 101, status: 'on_site', customer_id: 'c-1', truck_id: 't-1', day: '2026-11-17', block: 'pm', created_by: null } as unknown as Job;
const item = (id: string, o: Partial<JobItem> = {}) => ({ id, job_id: 'j-1', kind: 'service', service_id: null, item_id: null, description: `Travail ${id}`, qty: 1, unit_cents: 10000,
  taxable: true, status: 'planned', sort: 1, created_at: '2026-11-17T13:00:00.000Z', updated_at: '2026-11-17T13:00:00.000Z', ...o }) as unknown as JobItem;
const line = (id: string) => ({ description: `Travail ${id}`, qty: 1, unit_cents: 10000, taxable: true, kind: 'service', item_id: id });
const draft = (o: Partial<Invoice> = {}) => ({ id: 'f-1', job_id: 'j-1', customer_id: 'c-1', status: 'draft', number: null, lang: 'fr', taxes_on: true, notes: null, lines: [line('a')],
  subtotal_cents: 0, tps_cents: 0, tvq_cents: 0, total_cents: 0, paid_cents: 0, created_at: made, updated_at: made, ...o }) as unknown as Invoice;
const seed = (inv: Invoice, items: JobItem[]) => {
  replaceLocal('jobs', [job]);
  replaceLocal('job_items', items);
  replaceLocal('invoices', [inv]);
  replaceLocal('payments', []);
};

beforeEach(() => {
  lang.value = 'fr';
  access.value = { id: 'u-1', full_name: 'Hassan', short_name: null, email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null, rights: {} as Access['rights'], trucks: [] };
  vi.clearAllMocks();
});
afterEach(async () => {
  // a question left open (« Oui, terminer la facture ») lives in the ask queue, not in the render: answered « no » here,
  // it never shows in the next test, nor makes that test find an « ask-ok » that is not its own (review invoices)
  for (let i = 0; i < 5 && sheet('ask-ok'); i++) await answer(askCancel());
  expect(sheet('ask-ok')).toBeNull();
  act(() => render(null, box)); clearAll(); access.value = null; toasts.value = [];
});

describe('no invoice yet', () => {
  it('« Faire la facture » asks the server for a draft without rewriting one that exists (p_refresh false, R52)', async () => {
    replaceLocal('jobs', [job]);
    replaceLocal('job_items', [item('a')]);
    replaceLocal('invoices', []);
    replaceLocal('payments', []);
    await draw();
    await act(async () => { q('invoice-make')!.click(); });
    await wait();
    expect(api.invoiceForJob).toHaveBeenCalledWith('j-1', false);
  });
});

describe('a draft invoice', () => {
  it('an extra the customer accepted after the draft was made goes on it by itself, and is saved', async () => {
    seed(draft(), [item('a'), item('b', { status: 'approved', answered_at: '2026-11-17T14:30:00.000Z', updated_at: '2026-11-17T14:30:00.000Z' })]);
    await draw();
    const words = [...box.querySelectorAll<HTMLInputElement>('[data-testid="line-desc"]')].map((i) => i.value);
    expect(words).toEqual(['Travail a', 'Travail b']);
    await wait(900);
    expect(api.saveInvoiceDraft).toHaveBeenCalledWith('f-1', { lines: [line('a'), line('b')] });
  });
  it('work of the job taken off the draft by hand, then marked done, is not put back by itself (review inv-r2)', async () => {
    seed(draft(), [item('a'), item('b', { status: 'done', updated_at: '2026-11-17T15:30:00.000Z' })]);
    await draw();
    const words = [...box.querySelectorAll<HTMLInputElement>('[data-testid="line-desc"]')].map((i) => i.value);
    expect(words).toEqual(['Travail a']);
    await wait(900);
    expect(api.saveInvoiceDraft).not.toHaveBeenCalled();
  });
  it('« Terminer la facture » with billable work missing asks first; « Pas fait, terminer » says it and marks that work « Pas fait », then finishes (lead-watch terrain-01, S58)', async () => {
    // work older than the draft and not on it: it was taken off by hand, so it is not put back by itself
    seed(draft(), [item('a'), item('old')]);
    await draw();
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    expect(sheet('missing-work')?.textContent).toContain('Travail old');
    // what the tap does is said before it (review invoices: before, « Terminer sans » did it without a word)
    expect(sheet('missing-work-without')!.textContent).toBe('Pas fait, terminer');
    expect(plain(sheet('missing-work-not-done')!.textContent)).toBe('« Pas fait, terminer » : ce travail sera marqué « Pas fait » et ne sera pas facturé.');
    expect(api.finishInvoice).not.toHaveBeenCalled();
    await act(async () => { sheet('missing-work-without')!.click(); });
    await wait();
    // left billable, the server would refuse « Terminé » for the job (jobs_unbilled_guard): the mechanic paid, stuck
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith('old', { status: 'removed' });
    expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
    expect(api.updateItem.mock.invocationCallOrder[0]).toBeLessThan(api.finishInvoice.mock.invocationCallOrder[0]);
    expect(api.saveInvoiceDraft).not.toHaveBeenCalled();
  });
  it('« Pas fait, terminer » with two pieces of work left off marks both; work that came missing while the sheet was open is asked again first (S58)', async () => {
    seed(draft(), [item('a'), item('old'), item('old2')]);
    await draw();
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    expect(sheet('missing-work')?.textContent).toMatch(/Travail old.*Travail old2/s);
    expect(plain(sheet('missing-work-not-done')!.textContent)).toBe('« Pas fait, terminer » : ces travaux seront marqués « Pas fait » et ne seront pas facturés.');
    // another piece of work, already older than the draft, shows up on the phone (pulled) while the sheet is open
    replaceLocal('job_items', [item('a'), item('old'), item('old2'), item('late', { created_at: '2026-11-17T12:00:00.000Z' })]);
    await wait();
    await act(async () => { sheet('missing-work-without')!.click(); });
    await wait();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(api.finishInvoice).not.toHaveBeenCalled();
    expect(sheet('missing-work')?.textContent).toContain('Travail late');
    await act(async () => { sheet('missing-work-without')!.click(); });
    await wait();
    expect([...(api.updateItem.mock.calls as unknown as [string, unknown][])].sort((x, y) => x[0].localeCompare(y[0])))
      .toEqual([['late', { status: 'removed' }], ['old', { status: 'removed' }], ['old2', { status: 'removed' }]]);
    expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
  });
  it('« Pas fait, terminer » refused on the phone (no « Pas fait » sent): the invoice is not finished (S58)', async () => {
    api.updateItem.mockImplementationOnce(async () => { throw new Error('nope'); });
    seed(draft(), [item('a'), item('old')]);
    await draw();
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    await act(async () => { sheet('missing-work-without')!.click(); });
    await wait();
    expect(api.updateItem).toHaveBeenCalledWith('old', { status: 'removed' });
    expect(api.finishInvoice).not.toHaveBeenCalled();
  });
  it('someone who may finish the invoice but not change the job\'s work (« Factures » only): no « Pas fait, terminer », only « Ajouter et terminer » (S58)', async () => {
    // job_items_editable: the booking right, the job's truck or its author; « Factures » alone is not enough for « Pas fait »
    access.value = { ...access.value!, roles: ['office'], owner: false, rights: { edit_invoices: true } as unknown as Access['rights'] };
    seed(draft(), [item('a'), item('old')]);
    await draw();
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    expect(sheet('missing-work')?.textContent).toContain('Travail old');
    expect(sheet('missing-work-without')).toBeNull();
    expect(sheet('missing-work-not-done')).toBeNull();
    expect(sheet('missing-work-add')).not.toBeNull();
    await act(async () => { sheet('missing-work-add')!.click(); });
    await wait();
    expect(api.saveInvoiceDraft).toHaveBeenCalledWith('f-1', { lines: [line('a'), line('old')] });
    expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
    expect(api.updateItem).not.toHaveBeenCalled();
  });
  it('a job already over: « Terminer sans » finishes as it is, the work is not touched, and no « Pas fait » is said (S58)', async () => {
    seed(draft(), [item('a'), item('old')]);
    replaceLocal('jobs', [{ ...job, status: 'done' } as Job]);
    await draw();
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    expect(sheet('missing-work-without')!.textContent).toBe('Terminer sans');
    expect(sheet('missing-work-not-done')).toBeNull();
    await act(async () => { sheet('missing-work-without')!.click(); });
    await wait();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
  });
  it('« Ajouter et terminer » puts the work on the invoice before it gets its number', async () => {
    seed(draft(), [item('a'), item('old')]);
    await draw();
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    await act(async () => { sheet('missing-work-add')!.click(); });
    await wait();
    expect(api.saveInvoiceDraft).toHaveBeenCalledWith('f-1', { lines: [line('a'), line('old')] });
    expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
    // the save went first (the finish is queued behind it)
    expect(api.saveInvoiceDraft.mock.invocationCallOrder[0]).toBeLessThan(api.finishInvoice.mock.invocationCallOrder[0]);
  });
  describe('« Modifier la facture », then a total under what the customer paid (owner, 2026-11-20)', () => {
    // paid 114,98 $ before « Modifier la facture » (the payment waits on the job); a part taken off, 50 $ left: 57,49 $
    const lowLines = [{ description: 'Travail a', qty: 1, unit_cents: 5000, taxable: true, kind: 'service', item_id: 'a' }] as unknown as Invoice['lines'];
    const paidAhead = () => replaceLocal('payments', [{ id: 'p-1', invoice_id: null, job_id: 'j-1', amount_cents: 11498, method: 'cash', reference: null, paid_at: made, created_at: made, deleted_at: null } as never]);
    it('numbered draft under what was paid: the question with the amounts; « Revoir la facture » stays a draft, « Oui » finishes (no refusal, no toast)', async () => {
      seed(draft({ number: 51, lines: lowLines }), [item('a', { unit_cents: 5000 })]);
      paidAhead();
      api.finishInvoice.mockImplementationOnce(async () => ({ queued: false, data: { ok: true, number: 51, again: true, over_cents: 5749 } }) as never);
      await draw();
      // the warning says what will happen, no longer « ne se termine pas plus bas »
      expect(plain(q('draft-paid-ahead')?.textContent)).toBe('Le client a déjà payé 114,98 $, soit 57,49 $ de plus que ce total. Si tu termines comme ça, la facture sera marquée PAYÉ et le bureau remettra 57,49 $ au client.');
      await act(async () => { q('invoice-finish')!.click(); });
      await wait();
      expect(sheet('ask-ok')).not.toBeNull();
      expect(plain(document.body.textContent)).toContain('57,49 $ à remettre au client');
      expect(plain(document.body.textContent)).toContain('Le client a déjà payé 114,98 $. Avec ce total, 57,49 $ est à lui remettre : le bureau s’en occupe.');
      expect(sheet('ask-ok')!.textContent).toBe('Oui, terminer la facture');
      expect(askCancel()?.textContent).toBe('Revoir la facture');
      expect(api.finishInvoice).not.toHaveBeenCalled();
      // « Revoir la facture »: nothing sent, still the draft to change
      await answer(askCancel());
      expect(sheet('ask-ok')).toBeNull();
      expect(api.finishInvoice).not.toHaveBeenCalled();
      expect(q('draft-reopened')).not.toBeNull();
      expect(q('invoice-finish')).not.toBeNull();
      // asked again, « Oui »: finished
      await act(async () => { q('invoice-finish')!.click(); });
      await wait();
      await answer(sheet('ask-ok'));
      expect(api.finishInvoice).toHaveBeenCalledTimes(1);
      expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
      expect(toasts.value.filter((x) => x.kind === 'bad')).toEqual([]);
      expect(toasts.value.map((x) => plain(x.text))).toContain('Facture F-0051 terminée de nouveau.');
    });
    it('« Pas fait, terminer » with the total under what was paid: the question comes first, nothing marked « Pas fait » when the answer is no (S58)', async () => {
      seed(draft({ number: 51, lines: lowLines }), [item('a', { unit_cents: 5000 }), item('old')]);
      paidAhead();
      await draw();
      await act(async () => { q('invoice-finish')!.click(); });
      await wait();
      await act(async () => { sheet('missing-work-without')!.click(); });
      await wait();
      expect(sheet('ask-ok')).not.toBeNull();
      await answer(askCancel());
      expect(api.updateItem).not.toHaveBeenCalled();
      expect(api.finishInvoice).not.toHaveBeenCalled();
    });
    it('the mechanic of the job says yes: the invoice is PAID and he reads that the office gives the money back, with no refund button', async () => {
      access.value = { ...access.value!, roles: ['mechanic'], owner: false, trucks: ['t-1'] };
      seed(draft({ number: 51, lines: lowLines }), [item('a', { unit_cents: 5000 })]);
      paidAhead();
      // the server's answer: finished « paid », the payment back on it, over_cents 5749
      api.finishInvoice.mockImplementationOnce(async () => {
        replaceLocal('invoices', [draft({ number: 51, status: 'paid', lines: lowLines, subtotal_cents: 5000, tps_cents: 250, tvq_cents: 499, total_cents: 5749, paid_cents: 11498, issued_at: made })]);
        replaceLocal('payments', [{ id: 'p-1', invoice_id: 'f-1', job_id: 'j-1', amount_cents: 11498, method: 'cash', reference: null, paid_at: made, created_at: made, deleted_at: null } as never]);
        return { queued: false, data: { ok: true, number: 51, again: true, over_cents: 5749 } } as never;
      });
      await draw();
      await act(async () => { q('invoice-finish')!.click(); });
      await wait();
      await answer(sheet('ask-ok'));
      expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
      expect(plain(q('invoice-over')?.textContent)).toContain('Trop-perçu : 57,49 $ à remettre au client');
      expect(plain(q('invoice-over')?.textContent)).toContain('Dis-le au bureau : c’est le bureau qui le rembourse.');
      expect(q('invoice-refund')).toBeNull();
    });
    it('a new draft (no number yet) under what was paid ahead: finished without a question, as before (its banner says it)', async () => {
      seed(draft({ lines: lowLines }), [item('a', { unit_cents: 5000 })]);
      paidAhead();
      await draw();
      // the office gives the rest back, never the mechanic (one cash refund on site + one by the office = paid out twice)
      expect(plain(q('draft-paid-ahead')?.textContent)).toBe('Le client a déjà payé 114,98 $, soit 57,49 $ de plus que la facture. Une fois la facture terminée, le bureau lui remettra 57,49 $.');
      await act(async () => { q('invoice-finish')!.click(); });
      await wait();
      expect(sheet('ask-ok')).toBeNull();
      expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
    });
    it('a numbered draft at or over what was paid: no question', async () => {
      seed(draft({ number: 51 }), [item('a')]);
      paidAhead();
      await draw();
      await act(async () => { q('invoice-finish')!.click(); });
      await wait();
      expect(sheet('ask-ok')).toBeNull();
      expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
    });
  });
  it('a price typed wrong (red): « Terminer la facture » is refused and says why, never finished with the line at its old price (review invoices-r2-3)', async () => {
    seed(draft({ lines: [{ description: 'Travail a', qty: 1, unit_cents: 0, taxable: true, kind: 'service', item_id: 'a' }] as unknown as Invoice['lines'] }), [item('a', { unit_cents: 0 })]);
    await draw();
    const price = box.querySelector('.inv-line-price input') as HTMLInputElement;
    const type = async (s: string) => { await act(async () => { price.value = s; price.dispatchEvent(new Event('input', { bubbles: true })); }); };
    await type('12,,5');
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    expect(api.finishInvoice).not.toHaveBeenCalled();
    expect(toasts.value.map((x) => x.text)).toContain('Un prix est mal écrit : corrige le champ en rouge d’abord.');
    // the missing-work sheet's buttons too
    seed(draft({ lines: [{ description: 'Travail a', qty: 1, unit_cents: 0, taxable: true, kind: 'service', item_id: 'a' }] as unknown as Invoice['lines'] }), [item('a', { unit_cents: 0 }), item('old')]);
    await wait();
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    expect(sheet('missing-work')).toBeNull();
    expect(api.finishInvoice).not.toHaveBeenCalled();
    // typed right: finished
    replaceLocal('job_items', [item('a', { unit_cents: 0 })]);
    await type('12,50');
    await act(async () => { q('invoice-finish')!.click(); });
    await wait();
    expect(api.finishInvoice).toHaveBeenCalledWith('f-1');
  });
  it('a draft that holds a number (« Modifier la facture ») cannot be deleted; a new draft can', async () => {
    seed(draft({ number: 43 }), [item('a')]);
    await draw();
    expect(q('draft-reopened')).not.toBeNull();
    expect(q('draft-delete')).toBeNull();
    act(() => render(null, box));
    seed(draft(), [item('a')]);
    await draw();
    expect(q('draft-delete')).not.toBeNull();
  });
});

describe('a finished invoice', () => {
  const issued = (o: Partial<Invoice> = {}) => draft({ status: 'issued', number: 51, subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, issued_at: made, ...o });
  it('work of the job not on it is said, with « Modifier la facture »', async () => {
    seed(issued(), [item('a'), item('b', { status: 'approved', updated_at: '2026-11-17T15:00:00.000Z' })]);
    await draw();
    expect(q('invoice-unbilled')?.textContent).toContain('Travail b');
    expect(q('invoice-unbilled')?.querySelector('[data-testid="invoice-reopen"]')).not.toBeNull();
  });
  it('paid more than the total: « Trop-perçu » and « Inscrire le remboursement »', async () => {
    seed(issued({ status: 'paid', paid_cents: 20000 }), [item('a')]);
    await draw();
    expect(q('invoice-over')?.textContent).toMatch(/Trop-perçu.*85,02/s);
    expect(q('invoice-refund')).not.toBeNull();
    expect(q('invoice-unbilled')).toBeNull();
  });
  it('paid too much, seen by the mechanic of the job: told to tell the office, no « Inscrire le remboursement » (review argent-app-02)', async () => {
    // the server refuses a negative payment from anyone but the owner or « edit_invoices » (payment_add)
    access.value = { ...access.value!, roles: ['mechanic'], owner: false, trucks: ['t-1'] };
    seed(issued({ status: 'paid', paid_cents: 20000 }), [item('a')]);
    await draw();
    expect(q('invoice-over')?.textContent).toMatch(/Trop-perçu.*85,02/s);
    expect(q('invoice-over')?.textContent).toContain('Dis-le au bureau');
    expect(q('invoice-over')?.textContent).not.toContain('inscris-la ici');
    expect(q('invoice-refund')).toBeNull();
  });
  it('paid too much, seen by a booker without « Factures » rights: no refund either; the office (edit_invoices) has it', async () => {
    access.value = { ...access.value!, roles: ['office'], owner: false, rights: { book: true } as unknown as Access['rights'] };
    seed(issued({ status: 'paid', paid_cents: 20000 }), [item('a')]);
    await draw();
    expect(q('invoice-over')).not.toBeNull();
    expect(q('invoice-refund')).toBeNull();
    act(() => render(null, box));
    access.value = { ...access.value!, rights: { book: true, edit_invoices: true } as unknown as Access['rights'] };
    await draw();
    expect(q('invoice-over')?.textContent).toContain('inscris-la ici');
    expect(q('invoice-refund')).not.toBeNull();
  });
  it('paid, the job still under way: « Modifier la facture » (work added after the customer paid can be billed) (R42)', async () => {
    seed(issued({ status: 'paid', paid_cents: 11498 }), [item('a')]);
    await draw();
    expect(q('invoice-reopen')).not.toBeNull();
    // the job is done: the invoice no longer changes
    act(() => render(null, box));
    seed(issued({ status: 'paid', paid_cents: 11498 }), [item('a')]);
    replaceLocal('jobs', [{ ...job, status: 'done' } as Job]);
    await draw();
    expect(q('invoice-reopen')).toBeNull();
    // a mechanic of another truck neither (invoice_editable)
    act(() => render(null, box));
    access.value = { ...access.value!, roles: ['mechanic'], owner: false, trucks: ['t-9'] };
    seed(issued({ status: 'paid', paid_cents: 11498 }), [item('a')]);
    await draw();
    expect(q('invoice-reopen')).toBeNull();
  });
  it('paid MORE than the total (« Trop-perçu »), the job still under way: « Modifier la facture » too, so work added after can be billed without waiting for the office (owner, 2026-11-20)', async () => {
    // reopened, its draft holds 200 $ against 114,98 $: finished again « paid » after the question (no more below_paid)
    seed(issued({ status: 'paid', paid_cents: 20000 }), [item('a')]);
    await draw();
    expect(q('invoice-over')).not.toBeNull();
    expect(q('invoice-reopen')).not.toBeNull();
    // work added after it was paid too much: said, with the button (before: no button, the job could not be « Terminé »)
    act(() => render(null, box));
    seed(issued({ status: 'paid', paid_cents: 20000 }), [item('a'), item('b', { status: 'approved', updated_at: '2026-11-17T15:00:00.000Z' })]);
    await draw();
    expect(q('invoice-unbilled')?.textContent).toContain('Travail b');
    expect(q('invoice-unbilled')?.querySelector('[data-testid="invoice-reopen"]')).not.toBeNull();
    // for the mechanic of the job as well
    act(() => render(null, box));
    access.value = { ...access.value!, roles: ['mechanic'], owner: false, trucks: ['t-1'] };
    seed(issued({ status: 'paid', paid_cents: 20000 }), [item('a'), item('b', { status: 'approved', updated_at: '2026-11-17T15:00:00.000Z' })]);
    await draw();
    expect(q('invoice-unbilled')?.querySelector('[data-testid="invoice-reopen"]')).not.toBeNull();
  });
  it('« Encaisser » the balance', async () => {
    seed(issued(), [item('a')]);
    await draw();
    expect(q('invoice-pay')?.textContent).toMatch(/Encaisser 114,98/s);
    expect(q('invoice-over')).toBeNull();
  });
});
