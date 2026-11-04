/* The PDF of an invoice or an estimate, in the customer's language.
   Two steps: invoicePdfData / quotePdfData put together every word and number (pure, tested in pdf.test.ts);
   drawPdf draws them on a Letter page with jspdf + jspdf-autotable, loaded only when a PDF is asked. */
import type { Invoice, Quote, Customer, Vehicle, Payment, Settings, Lang, ItemKind } from '../../data/types';
import { tl } from '../../lib/i18n';
import { money } from '../../lib/money';
import { shortDate, dayOf } from '../../lib/dates';
import { formatPhone, fullName, findPostal } from '../../lib/text';
import { lineCents, linesTotals, invoiceAmounts, formatNumber, safeFileName, type LineLike } from './logic';

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
function qtyText(q: unknown, lang: Lang): string {
  const n = Number(q ?? 1);
  return new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 3 }).format(Number.isFinite(n) ? n : 1);
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
function vehicleText(v: Vehicle | null | undefined, lang: Lang, fallback?: string | null): string | null {
  if (!v) return fallback?.trim() || null;
  const parts = [[v.year, v.make, v.model].filter(Boolean).join(' ')];
  if (v.plate) parts.push(L(lang, 'plate', { p: v.plate }));
  if (v.odometer_km) parts.push(L(lang, 'km', { n: new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA').format(v.odometer_km) }));
  if (v.vin) parts.push(L(lang, 'vin', { v: v.vin }));
  return parts.filter(Boolean).join(', ') || fallback?.trim() || null;
}
/** the table rows; non-taxable lines get a « * » when some lines are taxed and others not */
function lineRows(lines: (LineLike & { kind?: ItemKind | string | null })[], lang: Lang, taxed: boolean): { rows: PdfData['rows']; taxNote: string | null } {
  const mixed = taxed && lines.some((l) => l.taxable === false) && lines.some((l) => l.taxable !== false);
  const rows = lines.map((l) => {
    const amount = lineCents(l);
    const unit = l.kind === 'discount' ? -Math.abs(Number(l.unit_cents || 0)) : Number(l.unit_cents || 0);
    const desc = String(l.description || '').trim() + (mixed && l.taxable === false ? ' *' : '');
    return [desc, qtyText(l.qty, lang), money(unit, lang), money(amount, lang)] as [string, string, string, string];
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
  }
  const who = whoOf(p.customer);
  return {
    kind: 'invoice', lang, title, number,
    docTitle: `${title} ${number}`.trim(),
    fileName: safeFileName(`${title} ${number}${who ? ` - ${who}` : ''}`) + '.pdf',
    meta,
    garage: garageBlock(p.settings, lang),
    to: p.customer ? { title: L(lang, 'billTo'), lines: customerLines(p.customer) } : null,
    vehicle: (() => { const v = vehicleText(p.vehicle, lang); return v ? { title: L(lang, 'vehicle'), text: v } : null; })(),
    head: [L(lang, 'description'), L(lang, 'qty'), L(lang, 'price'), L(lang, 'amount')],
    rows, taxNote, totals,
    payments: pays.length ? {
      title: L(lang, 'payments'),
      rows: pays.map((x) => [
        [tl(lang, `invoices.methods.${x.method}`), dayText(x.paid_at, lang), x.reference ? L(lang, 'ref', { r: x.reference }) : ''].filter(Boolean).join(', '),
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

/* ---------- drawing ---------- */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
/** the PDF's built-in font knows Latin-1 and a few more signs: the rest is replaced by its closest sign */
export function pdfText(s: string): string {
  return String(s ?? '')
    .replace(/[     ]/g, ' ')
    .replace(/[−‐‑‒]/g, '-')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[^\n\r\t -ÿ]/g, (ch) => (WIN_ANSI_EXTRA.includes(ch) ? ch : '?'));
}

let logoCache: Promise<string | null> | null = null;
function logoData(): Promise<string | null> {
  logoCache ||= fetch('./logo-his.png').then((r) => (r.ok ? r.blob() : null)).then((b) => b && new Promise<string | null>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || '') || null);
    fr.onerror = () => res(null);
    fr.readAsDataURL(b);
  })).catch(() => null);
  return logoCache;
}
/** loads the PDF tools ahead (on a phone, sharing must follow the tap quickly) */
export function preloadPdf() {
  void import('jspdf').catch(() => undefined);
  void import('jspdf-autotable').catch(() => undefined);
  void logoData();
}

type RGB = [number, number, number];
const INK: RGB = [16, 20, 24], INK2: RGB = [72, 81, 90], INK3: RGB = [107, 116, 125], LINE: RGB = [214, 218, 223], RED: RGB = [211, 0, 14];
const PAID: RGB = [21, 115, 71], VOID: RGB = [102, 112, 123];

export async function drawPdf(d: PdfData): Promise<Blob> {
  const [{ jsPDF }, at, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), logoData()]);
  const autoTable = at.autoTable || at.default;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 48, R = W - M;
  const T = pdfText;
  doc.setProperties({ title: T(d.docTitle), subject: T(d.docTitle), author: T(d.garage.name), creator: T(d.garage.name) });
  try { doc.setLanguage(d.lang === 'en' ? 'en-CA' : 'fr-CA'); } catch { /* old readers */ }
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (style: 'normal' | 'bold', size: number) => { doc.setFont('helvetica', style); doc.setFontSize(size); };

  /* the header: logo and garage on the left, the title and number on the right */
  let x = M, y = M;
  if (logo) {
    doc.setFillColor(0, 0, 0);
    doc.roundedRect(M, M, 54, 54, 10, 10, 'F');
    try { doc.addImage(logo, 'PNG', M + 4, M + 4, 46, 46, undefined, 'FAST'); } catch { /* no logo */ }
    x = M + 68;
  }
  font('bold', 15); color(INK);
  doc.text(T(d.garage.name), x, y + 13);
  font('normal', 8.5); color(INK2);
  let ly = y + 28;
  for (const line of d.garage.lines) {
    for (const part of doc.splitTextToSize(T(line), 260) as string[]) { doc.text(part, x, ly); ly += 11; }
  }
  font('normal', 24); color(INK);
  doc.text(T(d.title), R, y + 20, { align: 'right' });
  let ry = y + 40;
  if (d.number) { font('bold', 13); color(INK); doc.text(T(d.number), R, ry, { align: 'right' }); ry += 16; }
  font('normal', 9);
  const sep = d.lang === 'en' ? ': ' : ' : ';
  for (const [k, v] of d.meta) { color(INK3); doc.text(T(k + sep + v), R, ry, { align: 'right' }); ry += 12; }
  y = Math.max(ly, ry, logo ? M + 54 : 0) + 12;
  doc.setDrawColor(RED[0], RED[1], RED[2]); doc.setLineWidth(1.2);
  doc.line(M, y, R, y);
  y += 22;

  /* the customer and the vehicle */
  const blockTop = y;
  let by = y;
  if (d.to) {
    font('bold', 8.5); color(INK3); doc.text(T(d.to.title), M, by); by += 13;
    font('normal', 10); color(INK);
    for (const line of d.to.lines) { for (const part of doc.splitTextToSize(T(line), 250) as string[]) { doc.text(part, M, by); by += 13; } }
  }
  let vy = blockTop;
  if (d.vehicle) {
    const vx = W / 2 + 20;
    font('bold', 8.5); color(INK3); doc.text(T(d.vehicle.title), vx, vy); vy += 13;
    font('normal', 10); color(INK);
    for (const part of doc.splitTextToSize(T(d.vehicle.text), R - vx) as string[]) { doc.text(part, vx, vy); vy += 13; }
  }
  y = Math.max(by, vy) + (d.to || d.vehicle ? 10 : 0);

  /* the lines */
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 60 },
    head: [d.head.map(T)],
    body: d.rows.map((r) => r.map(T)),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, textColor: INK, cellPadding: { top: 6, bottom: 6, left: 6, right: 6 }, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', fontSize: 8.5, textColor: INK2, fillColor: [242, 243, 245] },
    bodyStyles: { lineWidth: { bottom: 0.5 }, lineColor: LINE },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 46 }, 2: { halign: 'right', cellWidth: 86 }, 3: { halign: 'right', cellWidth: 92 } },
    didParseCell: (h) => { if (h.section === 'head' && h.column.index > 0) h.cell.styles.halign = 'right'; }
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 8;
  if (d.taxNote) { font('normal', 8); color(INK3); doc.text(T(d.taxNote), M + 6, y + 8); }
  y += 14;

  const room = (h: number) => { if (y + h > H - 60) { doc.addPage(); y = M; } };

  /* the totals, on the right; the stamp beside them */
  const tw = 230, tx = R - tw;
  room(d.totals.length * 18 + 20);
  const totalsTop = y;
  for (const row of d.totals) {
    if (row.strong) {
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.8); doc.line(tx, y - 2, R, y - 2);
      y += 13; font('bold', 11.5); color(INK);
    } else { y += 12; font('normal', 9.5); color(INK2); }
    doc.text(T(row.label), tx + 6, y);
    doc.text(T(row.value), R - 6, y, { align: 'right' });
    y += row.strong ? 9 : 5;
  }
  if (d.stamp) {
    const c = d.stamp.tone === 'paid' ? PAID : VOID;
    const size = 30, angle = 12, rad = (angle * Math.PI) / 180;
    font('bold', size);
    const word = d.stamp.text.toLocaleUpperCase(d.lang === 'en' ? 'en-CA' : 'fr-CA');
    const tWidth = doc.getTextWidth(T(word)) + 6 * Math.max(0, word.length - 1);
    const w = tWidth + 28, h = size + 14;
    const cx = Math.max(M + w / 2 + 10, tx - w / 2 - 30), cy = totalsTop + Math.max(36, (y - totalsTop) / 2);
    const rot = (px: number, py: number): [number, number] => [cx + px * Math.cos(rad) + py * Math.sin(rad), cy - px * Math.sin(rad) + py * Math.cos(rad)];
    doc.saveGraphicsState();
    try { doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.85 })); } catch { /* opaque */ }
    doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(3);
    const pts = [rot(-w / 2, -h / 2), rot(w / 2, -h / 2), rot(w / 2, h / 2), rot(-w / 2, h / 2)];
    for (let i = 0; i < 4; i++) { const [ax, ay] = pts[i], [bx, by2] = pts[(i + 1) % 4]; doc.line(ax, ay, bx, by2); }
    color(c);
    doc.setCharSpace(6);
    const [sx, sy] = rot(-tWidth / 2, size * 0.35);
    doc.text(T(word), sx, sy, { angle });
    doc.setCharSpace(0);
    doc.restoreGraphicsState();
  }
  y += 10;

  /* payments received */
  if (d.payments) {
    room(d.payments.rows.length * 13 + 30);
    font('bold', 8.5); color(INK3); doc.text(T(d.payments.title), tx + 6, y + 8); y += 22;
    font('normal', 9); color(INK2);
    for (const [k, v] of d.payments.rows) {
      const parts = doc.splitTextToSize(T(k), tw - 90) as string[];
      parts.forEach((p, i) => doc.text(p, tx + 6, y + i * 11));
      doc.text(T(v), R - 6, y, { align: 'right' });
      y += parts.length * 11 + 3;
    }
    y += 6;
  }

  /* notes, then the garage's own words */
  if (d.notes) {
    const parts = doc.splitTextToSize(T(d.notes.text), R - M) as string[];
    room(parts.length * 12 + 26);
    y += 8;
    font('bold', 8.5); color(INK3); doc.text(T(d.notes.title), M, y); y += 13;
    font('normal', 9.5); color(INK);
    for (const p of parts) { room(12); doc.text(p, M, y); y += 12; }
  }
  if (d.footer.length) {
    y += 14;
    font('normal', 9); color(INK2);
    for (const f of d.footer) {
      for (const p of doc.splitTextToSize(T(f), R - M) as string[]) { room(12); doc.text(p, W / 2, y, { align: 'center' }); y += 12; }
    }
  }

  /* each page: who, and the page number */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.5); doc.line(M, H - 40, R, H - 40);
    font('normal', 8); color(INK3);
    doc.text(T(`${d.garage.name}${d.number ? `   ${d.title} ${d.number}` : ''}`), M, H - 26);
    doc.text(T(d.pageWord.replace('{n}', String(i)).replace('{total}', String(pages))), R, H - 26, { align: 'right' });
  }
  return doc.output('blob');
}
