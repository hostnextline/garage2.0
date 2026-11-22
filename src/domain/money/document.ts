/* The document of an invoice or an estimate, in the customer's language: every word and number it shows (pure,
   tested in document.test.ts). The PDF (shared/invoices/pdf.ts) and the invoice drawn on screen (InvoiceDocument)
   both draw this one object, so they always say the same thing, with the numbers of the one totals rule. */
import type { Invoice, Quote, Customer, Vehicle, Payment, Settings, Lang, ItemKind } from '../../data/types';
import { tl } from '../../lib/i18n';
import { money } from '../../lib/money';
import { shortDate, dayOf } from '../../lib/dates';
import { formatPhone, fullName, findPostal } from '../../lib/text';
import { lineCents, unitCents, lineQty, linesTotals, invoiceAmounts, formatNumber, type LineLike } from './invoice';
import { safeFileName } from './files';

export interface PdfData {
  kind: 'invoice' | 'quote';
  lang: Lang;
  fileName: string;
  /** the document's own title (« Facture F-0043 ») */
  docTitle: string;
  /** « Facture », « Estimation » */
  title: string;
  number: string;
  meta: [string, string][];
  garage: { name: string; lines: string[] };
  to: { title: string; lines: string[] } | null;
  vehicle: { title: string; text: string } | null;
  head: [string, string, string, string];
  rows: [string, string, string, string][];
  taxNote: string | null;
  totals: { label: string; value: string; strong?: boolean }[];
  payments: { title: string; rows: [string, string][] } | null;
  notes: { title: string; text: string } | null;
  footer: string[];
  stamp: { text: string; tone: 'paid' | 'void' } | null;
  /** « Page {n} / {total} » */
  pageWord: string;
}
type Billing = Settings['billing'] & { quote_prefix?: string; terms_fr?: string; terms_en?: string };
type SettingsPart = { company: Settings['company']; billing: Billing; taxes: Settings['taxes'] };

const L = (lang: Lang, key: string, vars?: Record<string, string | number>) => tl(lang, `invoices.pdf.${key}`, vars);
function qtyText(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 3 }).format(n);
}
function rateText(r: number, lang: Lang): string {
  const n = new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 3 }).format(r * 100);
  return lang === 'en' ? `${n}%` : `${n} %`;
}
function dayText(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return shortDate(iso, lang);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : shortDate(dayOf(d), lang);
}

function garageBlock(s: SettingsPart, lang: Lang): PdfData['garage'] {
  const c = s.company || {};
  const name = c.name || 'Mécanique Mobile H.I.S';
  const lines: string[] = [];
  if (c.legal_name && c.legal_name !== name) lines.push(c.legal_name);
  if (c.address) lines.push(c.address);
  const contact = [c.phone ? formatPhone(c.phone) : '', c.email || ''].filter(Boolean);
  if (contact.length) lines.push(contact.join('   '));
  if (c.website) lines.push(c.website);
  const tax = [c.tps_no ? L(lang, 'tpsNo', { n: c.tps_no }) : '', c.tvq_no ? L(lang, 'tvqNo', { n: c.tvq_no }) : ''].filter(Boolean);
  if (tax.length) lines.push(tax.join('   '));
  if (c.neq) lines.push(L(lang, 'neq', { n: c.neq }));
  return { name, lines };
}
function customerLines(c: Customer | null | undefined): string[] {
  if (!c) return [];
  const out: string[] = [];
  const person = fullName(c.first_name, c.last_name);
  if (c.company) out.push(c.company);
  if (person) out.push(person);
  if (c.address) {
    const addr = c.unit && !c.address.includes(c.unit) ? `${c.unit}-${c.address}` : c.address;
    out.push(addr);
    if (c.postal_code && !findPostal(c.address)) out.push(c.postal_code);
  }
  if (c.phone) out.push(formatPhone(c.phone));
  if (c.email) out.push(c.email);
  return out;
}
/** the car in one line; `visitKm`: the km read at this visit, written instead of the car's latest */
function vehicleText(v: Vehicle | null | undefined, lang: Lang, fallback?: string | null, visitKm?: number | null): string | null {
  if (!v) return fallback?.trim() || null;
  const parts = [[v.year, v.make, v.model].filter(Boolean).join(' ')];
  if (v.plate) parts.push(L(lang, 'plate', { p: v.plate }));
  const odo = visitKm ?? v.odometer_km;
  if (odo) parts.push(L(lang, 'km', { n: new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA').format(odo) }));
  if (v.vin) parts.push(L(lang, 'vin', { v: v.vin }));
  return parts.filter(Boolean).join(', ') || fallback?.trim() || null;
}
/** the table rows; non-taxable lines get a « * » when some lines are taxed and others not */
function lineRows(lines: (LineLike & { kind?: ItemKind | string | null })[], lang: Lang, taxed: boolean): { rows: PdfData['rows']; taxNote: string | null } {
  const mixed = taxed && lines.some((l) => l.taxable === false) && lines.some((l) => l.taxable !== false);
  const rows = lines.map((l) => {
    const desc = String(l.description || '').trim() + (mixed && l.taxable === false ? ' *' : '');
    return [desc, qtyText(lineQty(l), lang), money(unitCents(l), lang), money(lineCents(l), lang)] as [string, string, string, string];
  });
  return { rows, taxNote: mixed ? L(lang, 'taxNote') : null };
}
function footerOf(s: SettingsPart, lang: Lang): string[] {
  const c = s.company || {}, b = s.billing || ({} as Billing);
  return [lang === 'en' ? c.footer_en || c.footer_fr : c.footer_fr, lang === 'en' ? b.terms_en || b.terms_fr : b.terms_fr]
    .map((x) => (x || '').trim()).filter(Boolean);
}
function whoOf(c: Customer | null | undefined, contact?: string | null): string {
  return (c ? fullName(c.first_name, c.last_name) || c.company || '' : '') || (contact || '').trim();
}

export interface InvoicePdfInput {
  invoice: Invoice;
  customer?: Customer | null;
  vehicle?: Vehicle | null;
  /** the car's km read at this visit (the job's), written instead of the car's latest */
  km?: number | null;
  payments?: Payment[];
  settings: SettingsPart;
  /** the language of the document (the invoice's own language by default) */
  lang?: Lang;
}
export function invoicePdfData(p: InvoicePdfInput): PdfData {
  const inv = p.invoice;
  const lang: Lang = p.lang || (inv.lang === 'en' ? 'en' : 'fr');
  const b = p.settings.billing || ({} as Billing);
  const number = formatNumber(b.invoice_prefix ?? 'F-', b.pad ?? 4, inv.number);
  const a = invoiceAmounts(inv, p.settings.taxes);
  const title = L(lang, 'invoice');
  const { rows, taxNote } = lineRows(inv.lines || [], lang, a.showTaxes);
  const meta: [string, string][] = [];
  if (inv.issued_at) meta.push([L(lang, 'date'), dayText(inv.issued_at, lang)]);
  if (inv.due_on && inv.issued_at && inv.due_on > dayOf(new Date(inv.issued_at)) && inv.status === 'issued') meta.push([L(lang, 'due'), dayText(inv.due_on, lang)]);
  const totals: PdfData['totals'] = [{ label: L(lang, 'subtotal'), value: money(a.subtotal, lang) }];
  if (a.showTaxes) {
    totals.push({ label: `${L(lang, 'tps')} (${rateText(p.settings.taxes?.tps ?? 0.05, lang)})`, value: money(a.tps, lang) });
    totals.push({ label: `${L(lang, 'tvq')} (${rateText(p.settings.taxes?.tvq ?? 0.09975, lang)})`, value: money(a.tvq, lang) });
  }
  totals.push({ label: L(lang, 'total'), value: money(a.total, lang), strong: true });
  const pays = (p.payments || []).filter((x) => !x.deleted_at).sort((x, y) => String(x.paid_at).localeCompare(String(y.paid_at)));
  if (inv.status !== 'void' && a.paid > 0) {
    totals.push({ label: L(lang, 'paid'), value: money(-a.paid, lang) });
    totals.push({ label: L(lang, 'balance'), value: money(a.balance, lang), strong: true });
    // paid more than the total: what the garage owes back, as the screen says it (« Trop-perçu »)
    if (a.over > 0) totals.push({ label: L(lang, 'over'), value: money(a.over, lang) });
  }
  const who = whoOf(p.customer);
  return {
    kind: 'invoice', lang, title, number,
    docTitle: `${title} ${number}`.trim(),
    fileName: safeFileName(`${title} ${number}${who ? ` - ${who}` : ''}`) + '.pdf',
    meta,
    garage: garageBlock(p.settings, lang),
    to: p.customer ? { title: L(lang, 'billTo'), lines: customerLines(p.customer) } : null,
    vehicle: (() => { const v = vehicleText(p.vehicle, lang, null, p.km); return v ? { title: L(lang, 'vehicle'), text: v } : null; })(),
    head: [L(lang, 'description'), L(lang, 'qty'), L(lang, 'price'), L(lang, 'amount')],
    rows, taxNote, totals,
    payments: pays.length ? {
      title: L(lang, 'payments'),
      rows: pays.map((x) => [
        [x.amount_cents < 0 ? L(lang, 'refund', { how: tl(lang, `invoices.methods.${x.method}`) }) : tl(lang, `invoices.methods.${x.method}`),
          dayText(x.paid_at, lang), x.reference ? L(lang, 'ref', { r: x.reference }) : ''].filter(Boolean).join(', '),
        money(x.amount_cents, lang)
      ] as [string, string])
    } : null,
    notes: inv.notes?.trim() ? { title: L(lang, 'notes'), text: inv.notes.trim() } : null,
    footer: footerOf(p.settings, lang),
    stamp: inv.status === 'paid' ? { text: L(lang, 'stampPaid'), tone: 'paid' } : inv.status === 'void' ? { text: L(lang, 'stampVoid'), tone: 'void' } : null,
    pageWord: L(lang, 'page')
  };
}

export interface QuotePdfInput {
  quote: Quote;
  customer?: Customer | null;
  vehicle?: Vehicle | null;
  settings: SettingsPart;
  lang?: Lang;
}
export function quotePdfData(p: QuotePdfInput): PdfData {
  const q = p.quote;
  const lang: Lang = p.lang || (q.lang === 'en' ? 'en' : 'fr');
  const b = p.settings.billing || ({} as Billing);
  const number = formatNumber(b.quote_prefix ?? 'E-', b.pad ?? 4, q.number);
  const items = q.items || [];
  const tt = linesTotals(items, p.settings.taxes, true);
  const showTaxes = p.settings.taxes?.enabled !== false;
  const title = L(lang, 'quote');
  const { rows, taxNote } = lineRows(items, lang, showTaxes);
  const meta: [string, string][] = [];
  if (q.created_at) meta.push([L(lang, 'date'), dayText(q.created_at, lang)]);
  if (q.valid_until) meta.push([L(lang, 'validUntil'), dayText(q.valid_until, lang)]);
  const totals: PdfData['totals'] = [{ label: L(lang, 'subtotal'), value: money(tt.subtotal, lang) }];
  if (showTaxes) {
    totals.push({ label: `${L(lang, 'tps')} (${rateText(p.settings.taxes?.tps ?? 0.05, lang)})`, value: money(tt.tps, lang) });
    totals.push({ label: `${L(lang, 'tvq')} (${rateText(p.settings.taxes?.tvq ?? 0.09975, lang)})`, value: money(tt.tvq, lang) });
  }
  totals.push({ label: L(lang, 'total'), value: money(tt.total, lang), strong: true });
  const toLines = p.customer ? customerLines(p.customer) : [q.contact_name?.trim() || '', q.contact_phone ? formatPhone(q.contact_phone) : ''].filter(Boolean);
  const who = whoOf(p.customer, q.contact_name);
  const vText = vehicleText(p.vehicle, lang, q.vehicle_text);
  return {
    kind: 'quote', lang, title, number,
    docTitle: `${title} ${number}`.trim(),
    fileName: safeFileName(`${title}${number ? ` ${number}` : ''}${who ? ` - ${who}` : ''}`) + '.pdf',
    meta,
    garage: garageBlock(p.settings, lang),
    to: toLines.length ? { title: L(lang, 'preparedFor'), lines: toLines } : null,
    vehicle: vText ? { title: L(lang, 'vehicle'), text: vText } : null,
    head: [L(lang, 'description'), L(lang, 'qty'), L(lang, 'price'), L(lang, 'amount')],
    rows, taxNote, totals,
    payments: null,
    notes: q.notes?.trim() ? { title: L(lang, 'notes'), text: q.notes.trim() } : null,
    footer: [L(lang, 'quoteFooter'), ...footerOf(p.settings, lang)],
    stamp: null,
    pageWord: L(lang, 'page')
  };
}
