import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildXlsx, colName, excelDay, xmlText } from './xlsx';
import { buildWorkbook, buildCsv, csvCell, taxSummary, type ExportLabels, type RevenueLine, type ExpenseLine } from './exports';

const parse = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
};
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function cells(xml: string): Record<string, { t: string | null; s: string | null; v: string | null; text: string | null }> {
  const doc = parse(xml);
  const out: Record<string, { t: string | null; s: string | null; v: string | null; text: string | null }> = {};
  for (const c of Array.from(doc.getElementsByTagNameNS(NS, 'c'))) {
    out[c.getAttribute('r')!] = {
      t: c.getAttribute('t'), s: c.getAttribute('s'),
      v: c.getElementsByTagNameNS(NS, 'v')[0]?.textContent ?? null,
      text: c.getElementsByTagNameNS(NS, 't')[0]?.textContent ?? null
    };
  }
  return out;
}

describe('the XLSX writer', () => {
  it('column names and Excel days', () => {
    expect([colName(0), colName(25), colName(26), colName(27), colName(701), colName(702)]).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(excelDay('1900-03-01')).toBe(61);
    expect(excelDay('2026-11-04')).toBe(46330);
    expect(excelDay('nope')).toBeNull();
  });
  it('escapes text for XML and drops characters XML refuses', () => {
    expect(xmlText('Pièces & <outils> "A" l’auto \u0001')).toBe('Pièces &amp; &lt;outils&gt; &quot;A&quot; l’auto ');
  });
  it('makes a valid package: content types, relations, workbook, styles, one file per sheet', () => {
    const zip = unzipSync(buildXlsx([{ name: 'Revenus', rows: [['a']] }, { name: 'Dépenses', rows: [] }, { name: 'Taxes', rows: [[1]] }]));
    expect(Object.keys(zip).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'
    ]);
    for (const [name, data] of Object.entries(zip)) parse(strFromU8(data)) && expect(name).toBeTruthy();
    const types = strFromU8(zip['[Content_Types].xml']);
    expect(types).toContain('PartName="/xl/worksheets/sheet3.xml"');
    expect(types).toContain('spreadsheetml.sheet.main+xml');
    const wb = parse(strFromU8(zip['xl/workbook.xml']));
    expect(Array.from(wb.getElementsByTagNameNS(NS, 'sheet')).map((s) => s.getAttribute('name'))).toEqual(['Revenus', 'Dépenses', 'Taxes']);
    const rels = strFromU8(zip['xl/_rels/workbook.xml.rels']);
    expect(rels).toContain('Target="worksheets/sheet2.xml"');
    expect(rels).toContain('Target="styles.xml"');
  });
  it('writes text inline, numbers as numbers, money with 2 decimals, days as dates', () => {
    const zip = unzipSync(buildXlsx([{ name: 'S', rows: [
      ['Fournisseur', { v: 'Total', s: 'bold' }],
      ['Lordco & fils <pièces>', { v: 1234.56, s: 'money' }],
      [{ v: '2026-11-04', s: 'date' }, 42, null, '=SUM(A1)', '  espace  ']
    ] }]));
    const c = cells(strFromU8(zip['xl/worksheets/sheet1.xml']));
    expect(c.A1).toMatchObject({ t: 'inlineStr', text: 'Fournisseur' });
    expect(c.B1).toMatchObject({ t: 'inlineStr', s: '1', text: 'Total' });
    expect(c.A2.text).toBe('Lordco & fils <pièces>');
    expect(c.B2).toMatchObject({ t: null, s: '2', v: '1234.56' });
    expect(c.A3).toMatchObject({ s: '3', v: '46330' });
    expect(c.B3).toMatchObject({ t: null, v: '42' });
    expect(c.C3).toBeUndefined();
    // text that looks like a formula stays text (no <f>)
    expect(c.D3).toMatchObject({ t: 'inlineStr', text: '=SUM(A1)' });
    expect(strFromU8(zip['xl/worksheets/sheet1.xml'])).not.toContain('<f>');
    expect(c.E3.text).toBe('  espace  ');
    const styles = strFromU8(zip['xl/styles.xml']);
    expect(styles).toContain('formatCode="#,##0.00"');
    expect(styles).toContain('formatCode="yyyy-mm-dd"');
  });
  it('sheet names Excel accepts: 31 characters, no []:*?/\\, unique', () => {
    const zip = unzipSync(buildXlsx([{ name: 'Taxes', rows: [] }, { name: 'taxes', rows: [] }, { name: 'A/B:C*D?[E]'.padEnd(40, 'x'), rows: [] }]));
    const names = Array.from(parse(strFromU8(zip['xl/workbook.xml'])).getElementsByTagNameNS(NS, 'sheet')).map((s) => s.getAttribute('name')!);
    expect(names[0]).toBe('Taxes');
    expect(names[1]).toBe('taxes (2)');
    expect(names[2]).not.toMatch(/[[\]:*?/\\]/);
    expect(names[2].length).toBeLessThanOrEqual(31);
  });
});

const LABELS: ExportLabels = {
  sheets: { revenue: 'Revenus', expenses: 'Dépenses', taxes: 'Taxes' },
  revenue: { day: 'Date', number: 'Facture', customer: 'Client', subtotal: 'Avant taxes', tps: 'TPS', tvq: 'TVQ', total: 'Total', paid: 'Payé', status: 'Statut' },
  expenses: { day: 'Date', vendor: 'Fournisseur', category: 'Catégorie', description: 'Description', subtotal: 'Avant taxes', tps: 'TPS', tvq: 'TVQ', total: 'Total', method: 'Mode de paiement', truck: 'Camion', receipt: 'Reçu' },
  taxes: { title: 'Taxes de la période', period: 'Période', from: 'Du', to: 'Au', company: 'Entreprise', tpsNo: 'No TPS', tvqNo: 'No TVQ', tax: 'Taxe', collected: 'Perçue', paid: 'Payée', remit: 'À remettre', tps: 'TPS', tvq: 'TVQ', both: 'Total', revenue: 'Revenus avant taxes', expenses: 'Dépenses avant taxes', profit: 'Profit', note: 'Note' },
  totalRow: 'Total', yes: 'Oui', no: 'Non',
  csv: { day: 'Date', type: 'Type', number: 'Facture', name: 'Nom', category: 'Catégorie', description: 'Description', subtotal: 'Avant taxes', tps: 'TPS', tvq: 'TVQ', total: 'Total', method: 'Mode de paiement', revenue: 'Revenu', expense: 'Dépense' }
};
const REV: RevenueLine[] = [
  { day: '2026-11-04', number: 'F-0043', customer: 'Julie Tremblay', subtotal: 14999, tps: 750, tvq: 1496, total: 17245, paid: 17245, status: 'Payée' },
  { day: '2026-11-03', number: 'F-0042', customer: 'Livraisons Express; Laval', subtotal: 107376, tps: 5369, tvq: 10711, total: 123456, paid: 0, status: 'À payer' }
];
const EXP: ExpenseLine[] = [
  { day: '2026-11-03', vendor: 'Canadian Tire', category: 'Outils et équipement', description: 'Clé "3/8"', subtotal: 8498, tps: 425, tvq: 848, total: 9771, method: 'Débit', truck: 'Camion Complet', receipt: true },
  { day: '2026-11-01', vendor: '=HYPERLINK("x")', category: 'Assurances', description: '', subtotal: 21240, tps: 0, tvq: 0, total: 21240, method: 'Crédit', truck: '', receipt: false }
];

describe('the accountant’s workbook', () => {
  const zip = unzipSync(buildWorkbook({ from: '2026-11-01', to: '2026-11-30', revenue: REV, expenses: EXP, company: { name: 'Mécanique Mobile H.I.S', tps_no: '775958648 RT0001', tvq_no: '1234321141 TQ0001' }, labels: LABELS }));
  it('has the sheets Revenus, Dépenses, Taxes', () => {
    const names = Array.from(parse(strFromU8(zip['xl/workbook.xml'])).getElementsByTagNameNS(NS, 'sheet')).map((s) => s.getAttribute('name'));
    expect(names).toEqual(['Revenus', 'Dépenses', 'Taxes']);
  });
  it('Revenus: one row per invoice by date, and exact totals', () => {
    const c = cells(strFromU8(zip['xl/worksheets/sheet1.xml']));
    expect(c.B2.text).toBe('F-0042');
    expect(c.D2.v).toBe('1073.76');
    expect(c.G2.v).toBe('1234.56');
    expect(c.A4.text).toBe('Total');
    expect(c.D4.v).toBe('1223.75');
    expect(c.G4.v).toBe('1407.01');
    expect(c.H4.v).toBe('172.45');
  });
  it('Dépenses: the receipt column, and a vendor that looks like a formula stays text', () => {
    const c = cells(strFromU8(zip['xl/worksheets/sheet2.xml']));
    expect(c.B2).toMatchObject({ t: 'inlineStr', text: '=HYPERLINK("x")' });
    expect(c.K3.text).toBe('Oui');
    expect(c.H4.v).toBe('310.11');
  });
  it('Taxes: collected minus paid, the tax numbers of the garage', () => {
    const xml = strFromU8(zip['xl/worksheets/sheet3.xml']);
    expect(xml).toContain('775958648 RT0001');
    const s = taxSummary(REV, EXP);
    expect(s.tpsToRemit).toBe(750 + 5369 - 425);
    expect(s.tvqToRemit).toBe(1496 + 10711 - 848);
    expect(s.profit).toBe(14999 + 107376 - 8498 - 21240);
    const values = Object.values(cells(xml)).map((x) => x.v);
    expect(values).toContain((s.tpsToRemit / 100).toFixed(2));
    expect(values).toContain((s.profit / 100).toFixed(2));
  });
});

describe('the CSV journal', () => {
  it('French: « ; », decimal comma, a BOM for Excel, sorted by date', () => {
    const csv = buildCsv({ from: '2026-11-01', to: '2026-11-30', revenue: REV, expenses: EXP, labels: LABELS }, 'fr');
    expect(csv.startsWith('﻿Date;Type;Facture')).toBe(true);
    const rows = csv.slice(1).trim().split('\r\n');
    expect(rows).toHaveLength(5);
    expect(rows[1]).toBe(`2026-11-01;Dépense;;"'=HYPERLINK(""x"")";Assurances;;212,40;0,00;0,00;212,40;Crédit`);
    expect(rows[2]).toContain('"Livraisons Express; Laval"');
    expect(rows[2]).toContain(';1073,76;53,69;107,11;1234,56;');
    expect(rows[3]).toContain('"Clé ""3/8"""');
  });
  it('English: « , » and decimal point', () => {
    const csv = buildCsv({ from: '2026-11-01', to: '2026-11-30', revenue: REV, expenses: [], labels: LABELS }, 'en');
    expect(csv).toContain(',1073.76,53.69,107.11,1234.56,');
  });
  it('quotes only what needs it', () => {
    expect(csvCell('simple', ';')).toBe('simple');
    expect(csvCell('a;b', ';')).toBe('"a;b"');
    expect(csvCell('a,b', ';')).toBe('a,b');
    expect(csvCell('+1 514', ';')).toBe("'+1 514");
    expect(csvCell(null, ';')).toBe('');
  });
});
