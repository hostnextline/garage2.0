/* What leaves the app as a file: a CSV for a spreadsheet in the person's language (French Excel reads « ; » and a
   decimal comma, English « , » and a point), and a file name every phone and computer accepts. */
import type { Lang } from '../../data/types';

export type CsvValue = string | number | null | undefined | { cents: number };
export function csvSeparator(lang: Lang): ';' | ',' { return lang === 'en' ? ',' : ';'; }
export function centsText(c: number, lang: Lang): string {
  const s = (Math.abs(c) / 100).toFixed(2);
  return (c < 0 ? '-' : '') + (lang === 'en' ? s : s.replace('.', ','));
}
export function csvCell(v: CsvValue, lang: Lang): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'object') s = centsText(v.cents, lang);
  else if (typeof v === 'number') s = lang === 'en' ? String(v) : String(v).replace('.', ',');
  else {
    s = String(v);
    // a name typed as « =… » must stay text in a spreadsheet, never become a formula
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  const sep = csvSeparator(lang);
  return s.includes(sep) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** the whole file: a BOM (accents read right by Excel), one line per row, Windows line ends */
export function toCsv(rows: CsvValue[][], lang: Lang): string {
  const sep = csvSeparator(lang);
  return '﻿' + rows.map((r) => r.map((c) => csvCell(c, lang)).join(sep)).join('\r\n') + '\r\n';
}

/** a file name a phone and a computer both accept */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
}
