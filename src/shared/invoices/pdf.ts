/* The PDF of an invoice or an estimate: draws the document's words and numbers (domain/money/document.ts, the same
   object the screen draws) on a Letter page with jspdf + jspdf-autotable, loaded only when a PDF is asked. */
export type { PdfData } from '../../domain/money/document';
import type { PdfData } from '../../domain/money/document';

/* ---------- drawing ---------- */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
/** letters the PDF's built-in font cannot draw and that no accent removal brings back to Latin-1 */
const NEAR: Record<string, string> = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ħ': 'H', 'ħ': 'h', 'ı': 'i', 'Ŀ': 'L', 'ŀ': 'l', 'ŉ': "'n" };
const drawable = (ch: string) => /^[\n\r\t -ÿ]$/.test(ch) || WIN_ANSI_EXTRA.includes(ch);
/** the PDF's built-in font knows Latin-1 and a few more signs: a letter with an accent it does not have loses the
    accent (« Nguyễn » prints « Nguyen », not « Nguy?n »); what is left without a near letter becomes « ? » */
export function pdfText(s: string): string {
  return String(s ?? '')
    .replace(/[\u202f\u2009\u2007\u2008\u200a]/g, '\u00a0')
    .replace(/[\u2212\u2010\u2011\u2012]/g, '-')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[^\n\r\t -ÿ]/g, (ch) => {
      if (WIN_ANSI_EXTRA.includes(ch)) return ch;
      if (NEAR[ch]) return NEAR[ch];
      const bare = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return bare && [...bare].every(drawable) ? bare : '?';
    });
}

let logoCache: Promise<string | null> | null = null;
/** the logo as data for the PDF; a failed fetch (no signal) is asked again next time instead of a PDF without logo
    for the whole visit */
function logoData(): Promise<string | null> {
  logoCache ||= fetch('./logo-his.png').then((r) => (r.ok ? r.blob() : null)).then((b) => b && new Promise<string | null>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || '') || null);
    fr.onerror = () => res(null);
    fr.readAsDataURL(b);
  })).catch(() => null).then((d) => { if (!d) logoCache = null; return d; });
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
