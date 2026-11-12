import { describe, it, expect } from 'vitest';
import { invoicePdfData, quotePdfData, pdfText } from './pdf';
import type { Invoice, Quote, Customer, Vehicle, Payment, Settings } from '../../data/types';

/* Intl puts no-break spaces in « 89,99 $ » and may write a real minus sign: compare with plain ones */
const n = (s: string) => s.replace(/[  ]/g, ' ').replace(/−/g, '-');
const nn = (a: unknown) => JSON.parse(n(JSON.stringify(a)));

const settings = {
  company: { name: 'Mécanique Mobile H.I.S', phone: '4389016606', email: 'garage@example.com', address: '8255 av. Mountain Sights, Montréal, QC H4P 2B5',
    tps_no: '775958648 RT0001', tvq_no: '1234321141 TQ0001', footer_fr: 'Merci de votre confiance !', footer_en: 'Thank you for your trust!' },
  billing: { invoice_prefix: 'F-', pad: 4, due_days: 0, hourly_cents: 11500, travel: { cents: 0, free_over_cents: null }, terms_fr: 'Payable à la réception.', terms_en: 'Due on receipt.' },
  taxes: { enabled: true, tps: 0.05, tvq: 0.09975 }
} as unknown as Pick<Settings, 'company' | 'billing' | 'taxes'>;
const julie = { id: 'c-julie', first_name: 'Julie', last_name: 'Tremblay', company: null, phone: '514 555-0141', email: 'julie.t@example.com', lang: 'fr',
  address: '1250 rue Graham, Mont-Royal, QC', unit: null, postal_code: 'H3P 2C9' } as unknown as Customer;
const civic = { id: 'v-julie', year: 2019, make: 'Honda', model: 'Civic', plate: 'ABC 123', odometer_km: 84200, vin: null } as unknown as Vehicle;
const midday = (d: number) => new Date(2026, 10, d, 12, 0).toISOString();
const paidInvoice = {
  id: 'f-1', job_id: 'j-1', customer_id: 'c-julie', number: 43, status: 'paid', issued_at: midday(4), due_on: '2026-11-04', lang: 'fr', taxes_on: true, notes: 'Merci Julie.',
  lines: [{ description: 'Changement d’huile et filtre', qty: 1, unit_cents: 8999, taxable: true, kind: 'service' }, { description: 'Top up des liquides', qty: 1, unit_cents: 6000, taxable: true, kind: 'service' }],
  subtotal_cents: 14999, taxable_cents: 14999, tps_cents: 750, tvq_cents: 1496, total_cents: 17245, paid_cents: 17245
} as unknown as Invoice;
const pay = { id: 'p-1', invoice_id: 'f-1', job_id: 'j-1', amount_cents: 17245, method: 'debit', paid_at: midday(4), reference: null } as unknown as Payment;

describe('invoice PDF, in French', () => {
  const d = nn(invoicePdfData({ invoice: paidInvoice, customer: julie, vehicle: civic, payments: [pay], settings }));
  it('names the file like Hassan files them', () => expect(d.fileName).toBe('Facture F-0043 - Julie Tremblay.pdf'));
  it('has the garage, its tax numbers and the customer', () => {
    expect(d.title).toBe('Facture');
    expect(d.number).toBe('F-0043');
    expect(d.garage.name).toBe('Mécanique Mobile H.I.S');
    expect(d.garage.lines).toContain('8255 av. Mountain Sights, Montréal, QC H4P 2B5');
    expect(d.garage.lines).toContain('438 901-6606   garage@example.com');
    expect(d.garage.lines).toContain('TPS : 775958648 RT0001   TVQ : 1234321141 TQ0001');
    expect(d.to).toEqual({ title: 'Facturé à', lines: ['Julie Tremblay', '1250 rue Graham, Mont-Royal, QC', 'H3P 2C9', '514 555-0141', 'julie.t@example.com'] });
    expect(d.vehicle).toEqual({ title: 'Véhicule', text: '2019 Honda Civic, plaque ABC 123, 84 200 km' });
    expect(d.meta).toEqual([['Date', '4 nov. 2026']]);
  });
  it('writes the km read at this visit when the job has one', () => {
    const v = nn(invoicePdfData({ invoice: paidInvoice, customer: julie, vehicle: civic, km: 91350, payments: [pay], settings }));
    expect(v.vehicle).toEqual({ title: 'Véhicule', text: '2019 Honda Civic, plaque ABC 123, 91 350 km' });
  });
  it('lists the lines and the totals with TPS and TVQ', () => {
    expect(d.head).toEqual(['Description', 'Qté', 'Prix', 'Montant']);
    expect(d.rows).toEqual([['Changement d’huile et filtre', '1', '89,99 $', '89,99 $'], ['Top up des liquides', '1', '60,00 $', '60,00 $']]);
    expect(d.totals).toEqual([
      { label: 'Sous-total', value: '149,99 $' }, { label: 'TPS (5 %)', value: '7,50 $' }, { label: 'TVQ (9,975 %)', value: '14,96 $' },
      { label: 'Total', value: '172,45 $', strong: true }, { label: 'Payé', value: '-172,45 $' }, { label: 'Reste à payer', value: '0,00 $', strong: true }
    ]);
  });
  it('shows the payment, the note, the garage’s words and the PAYÉ stamp', () => {
    expect(d.payments).toEqual({ title: 'Paiements reçus', rows: [['Débit, 4 nov. 2026', '172,45 $']] });
    expect(d.notes).toEqual({ title: 'Note', text: 'Merci Julie.' });
    expect(d.footer).toEqual(['Merci de votre confiance !', 'Payable à la réception.']);
    expect(d.stamp).toEqual({ text: 'Payé', tone: 'paid' });
    expect(d.pageWord).toBe('Page {n} de {total}');
  });
});

describe('invoice PDF, in English (the customer’s language)', () => {
  const kevin = { ...julie, first_name: 'Kevin', last_name: 'Nguyen', lang: 'en', postal_code: null, address: '4800 ch. de la Côte-des-Neiges, Montréal, QC H3V 1G8' } as unknown as Customer;
  const inv = {
    ...paidInvoice, number: 38, status: 'issued', lang: 'en', paid_cents: 10000, notes: null,
    lines: [{ description: 'Rear brakes (pads and rotors)', qty: 1, unit_cents: 34999, taxable: true, kind: 'service' }, { description: 'Disposal fee', qty: 2, unit_cents: 225, taxable: false, kind: 'fee' }],
    subtotal_cents: 35449, taxable_cents: 34999, tps_cents: 1750, tvq_cents: 3491, total_cents: 40690
  } as unknown as Invoice;
  const p = { ...pay, amount_cents: 10000, method: 'interac', reference: 'CA7Q2KX9' } as unknown as Payment;
  const d = nn(invoicePdfData({ invoice: inv, customer: kevin, payments: [p], settings }));
  it('uses English words and Canadian English amounts', () => {
    expect(d.fileName).toBe('Invoice F-0038 - Kevin Nguyen.pdf');
    expect(d.title).toBe('Invoice');
    expect(d.head).toEqual(['Description', 'Qty', 'Price', 'Amount']);
    expect(d.meta).toEqual([['Date', 'Nov 4, 2026']]);
    expect(d.garage.lines).toContain('GST: 775958648 RT0001   QST: 1234321141 TQ0001');
    expect(d.to.title).toBe('Bill to');
    expect(d.to.lines).not.toContain(null);
  });
  it('marks the non-taxable line and taxes only the rest', () => {
    expect(d.rows).toEqual([['Rear brakes (pads and rotors)', '1', '$349.99', '$349.99'], ['Disposal fee *', '2', '$2.25', '$4.50']]);
    expect(d.taxNote).toBe('* Not taxable');
    expect(d.totals.map((x: { label: string; value: string }) => `${x.label}=${x.value}`)).toEqual([
      'Subtotal=$354.49', 'GST (5%)=$17.50', 'QST (9.975%)=$34.91', 'Total=$406.90', 'Paid=-$100.00', 'Balance due=$306.90'
    ]);
  });
  it('lists the Interac payment with its reference, no stamp while unpaid', () => {
    expect(d.payments.rows).toEqual([['Interac e-Transfer, Nov 4, 2026, ref. CA7Q2KX9', '$100.00']]);
    expect(d.stamp).toBeNull();
    expect(d.footer).toEqual(['Thank you for your trust!', 'Due on receipt.']);
  });
  it('a French invoice can be printed in English when asked', () => {
    expect(n(invoicePdfData({ invoice: paidInvoice, customer: julie, settings, lang: 'en' }).totals[0].value)).toBe('$149.99');
  });
});

describe('invoice PDF: discounts, taxes off, cancelled', () => {
  it('a discount line shows a negative amount and lowers the total', () => {
    const inv = { ...paidInvoice, status: 'issued', paid_cents: 0, lines: [{ description: 'Freins', qty: 1, unit_cents: 34999, taxable: true }, { description: 'Rabais 10 %', qty: 1, unit_cents: 3500, taxable: true, kind: 'discount' }],
      subtotal_cents: 31499, tps_cents: 1575, tvq_cents: 3142, total_cents: 36216 } as unknown as Invoice;
    const d = nn(invoicePdfData({ invoice: inv, customer: julie, settings }));
    expect(d.rows[1]).toEqual(['Rabais 10 %', '1', '-35,00 $', '-35,00 $']);
    expect(d.totals.map((x: { label: string }) => x.label)).toEqual(['Sous-total', 'TPS (5 %)', 'TVQ (9,975 %)', 'Total']);
  });
  it('an exempt invoice has no tax lines', () => {
    const inv = { ...paidInvoice, status: 'issued', taxes_on: false, tps_cents: 0, tvq_cents: 0, total_cents: 14999, paid_cents: 0 } as unknown as Invoice;
    expect(nn(invoicePdfData({ invoice: inv, settings })).totals).toEqual([{ label: 'Sous-total', value: '149,99 $' }, { label: 'Total', value: '149,99 $', strong: true }]);
  });
  it('a cancelled invoice gets the ANNULÉE stamp and no balance', () => {
    const d = invoicePdfData({ invoice: { ...paidInvoice, status: 'void', paid_cents: 0 } as Invoice, settings });
    expect(d.stamp).toEqual({ text: 'Annulée', tone: 'void' });
    expect(d.totals.at(-1)?.label).toBe('Total');
    expect(d.to).toBeNull();
    expect(d.fileName).toBe('Facture F-0043.pdf');
  });
});

describe('estimate PDF (no customer file needed)', () => {
  const q = { id: 'q-1', number: 7, customer_id: null, vehicle_id: null, vehicle_text: '2012 Toyota Corolla', contact_name: 'Client au stationnement', contact_phone: '5145550199',
    items: [{ description: 'Freins avant (plaquettes et disques)', qty: 1, unit_cents: 34999, taxable: true, service_id: 's-freins-av', duration_min: 90 }],
    notes: 'Prix donné sur place.', status: 'open', job_id: null, lang: 'fr', valid_until: '2026-12-04', created_at: midday(4) } as unknown as Quote;
  it('in French: the contact written on the spot, the car, valid until, the taxes', () => {
    const d = nn(quotePdfData({ quote: q, settings }));
    expect(d.fileName).toBe('Estimation E-0007 - Client au stationnement.pdf');
    expect(d.title).toBe('Estimation');
    expect(d.to).toEqual({ title: 'Préparé pour', lines: ['Client au stationnement', '514 555-0199'] });
    expect(d.vehicle).toEqual({ title: 'Véhicule', text: '2012 Toyota Corolla' });
    expect(d.meta).toEqual([['Date', '4 nov. 2026'], ['Valide jusqu’au', '4 déc. 2026']]);
    expect(d.totals.map((x: { value: string }) => x.value)).toEqual(['349,99 $', '17,50 $', '34,91 $', '402,40 $']);
    expect(d.payments).toBeNull();
    expect(d.stamp).toBeNull();
    expect(d.footer[0]).toMatch(/^Prix estimé/);
  });
  it('in English, with a customer file and its car', () => {
    const kevin = { ...julie, first_name: 'Kevin', last_name: 'Nguyen', lang: 'en' } as unknown as Customer;
    const d = nn(quotePdfData({ quote: { ...q, lang: 'en', customer_id: 'c-kevin', contact_name: null } as Quote, customer: kevin, vehicle: civic, settings }));
    expect(d.fileName).toBe('Estimate E-0007 - Kevin Nguyen.pdf');
    expect(d.to.title).toBe('Prepared for');
    expect(d.meta).toEqual([['Date', 'Nov 4, 2026'], ['Valid until', 'Dec 4, 2026']]);
    expect(d.vehicle.text).toBe('2019 Honda Civic, plate ABC 123, 84,200 km');
    expect(d.totals.at(-1)).toEqual({ label: 'Total', value: '$402.40', strong: true });
  });
  it('a new estimate (number not back from the server yet) still makes a file', () => {
    expect(quotePdfData({ quote: { ...q, number: null } as unknown as Quote, settings }).fileName).toBe('Estimation - Client au stationnement.pdf');
  });
});

describe('text for the PDF font', () => {
  it('keeps French letters and signs, replaces what the font cannot draw', () => {
    expect(pdfText('Facture payée à l’avance « ok » — 1 234,50 $')).toBe('Facture payée à l’avance « ok » — 1 234,50 $');
    expect(pdfText('−10,00 $')).toBe('-10,00 $');
    expect(pdfText('Merci 🙂')).toBe('Merci ??');
  });
});
