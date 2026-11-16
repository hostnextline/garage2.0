import { describe, it, expect } from 'vitest';
import type { Invoice } from '../../data/types';
import { QC_TAXES } from '../../lib/money';
import { projectInvoice } from './view';

const L = (unit_cents: number) => ({ description: 'x', qty: 1, unit_cents, taxable: true, kind: 'service' as const });
const issued = { id: 'f-1', job_id: 'j-1', status: 'issued', number: 51, lines: [L(10000)], taxes_on: true,
  subtotal_cents: 10000, tps_cents: 500, tvq_cents: 998, total_cents: 11498, paid_cents: 0 } as unknown as Invoice;
const draft = { ...issued, status: 'draft', number: null, subtotal_cents: 0, tps_cents: 0, tvq_cents: 0, total_cents: 0 } as unknown as Invoice;

describe('an invoice as this phone sees it', () => {
  it('a cash payment kept on the phone: nothing left to collect, so it is not offered twice', () => {
    const v = projectInvoice(issued, QC_TAXES, { finishing: false, waiting: 11498, ahead: 0 });
    expect(v).toMatchObject({ due: 0, over: 0, waiting: 11498 });
    expect(v.inv.status).toBe('issued');   // the server has not said « paid » yet
  });
  it('a part paid and waiting: only the rest is left', () => {
    expect(projectInvoice({ ...issued, paid_cents: 2000 } as Invoice, QC_TAXES, { finishing: false, waiting: 5000, ahead: 0 }).due).toBe(4498);
  });
  it('nothing waiting: the server balance', () => {
    expect(projectInvoice(issued, QC_TAXES, { finishing: false, waiting: 0, ahead: 0 })).toMatchObject({ due: 11498, over: 0 });
  });
  it('« Terminer la facture » waiting: the draft is shown finished with the totals of its lines, prepayments counted', () => {
    const v = projectInvoice(draft, QC_TAXES, { finishing: true, waiting: 0, ahead: 0 });
    expect(v.finishing).toBe(true);
    expect(v.inv).toMatchObject({ status: 'issued', total_cents: 11498, subtotal_cents: 10000 });
    expect(v.due).toBe(11498);
    const prepaid = projectInvoice(draft, QC_TAXES, { finishing: true, waiting: 0, ahead: 11498 });
    expect(prepaid.inv.status).toBe('paid');
    expect(prepaid.due).toBe(0);
  });
  it('a waiting finish then a payment taken behind it: nothing left to collect', () => {
    expect(projectInvoice(draft, QC_TAXES, { finishing: true, waiting: 11498, ahead: 0 }).due).toBe(0);
  });
  it('a draft with no waiting finish stays a draft', () => {
    const v = projectInvoice(draft, QC_TAXES, { finishing: false, waiting: 0, ahead: 0 });
    expect(v.finishing).toBe(false);
    expect(v.inv.status).toBe('draft');
  });
  it('paid twice: the money to give back; a refund waiting brings it to nothing', () => {
    const twice = { ...issued, status: 'paid', paid_cents: 22996 } as Invoice;
    expect(projectInvoice(twice, QC_TAXES, { finishing: false, waiting: 0, ahead: 0 }).over).toBe(11498);
    expect(projectInvoice(twice, QC_TAXES, { finishing: false, waiting: -11498, ahead: 0 }).over).toBe(0);
  });
  it('a cancelled invoice owes nothing and gives back what it holds', () => {
    expect(projectInvoice({ ...issued, status: 'void', paid_cents: 3000 } as Invoice, QC_TAXES, { finishing: false, waiting: 0, ahead: 0 })).toMatchObject({ due: 0, over: 3000 });
  });
});
