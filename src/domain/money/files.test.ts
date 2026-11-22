import { describe, it, expect } from 'vitest';
import { csvCell, toCsv, centsText, safeFileName } from './files';

describe('file names', () => {
  it('file names a phone accepts', () => {
    expect(safeFileName('Facture F-0043 - Julie / "Tremblay": ok?')).toBe('Facture F-0043 - Julie Tremblay ok');
  });
});

describe('CSV for a spreadsheet', () => {
  it('French: « ; » between cells and a decimal comma; English: « , » and a point', () => {
    expect(toCsv([['Numéro', 'Total'], ['F-0043', { cents: 17245 }]], 'fr')).toBe('﻿Numéro;Total\r\nF-0043;172,45\r\n');
    expect(toCsv([['Number', 'Total'], ['F-0043', { cents: 17245 }]], 'en')).toBe('﻿Number,Total\r\nF-0043,172.45\r\n');
  });
  it('quotes a cell that holds the separator, a quote or a line break', () => {
    expect(csvCell('Tremblay, Julie', 'en')).toBe('"Tremblay, Julie"');
    expect(csvCell('Tremblay, Julie', 'fr')).toBe('Tremblay, Julie');
    expect(csvCell('Garage; Laval', 'fr')).toBe('"Garage; Laval"');
    expect(csvCell('Le "garage"', 'fr')).toBe('"Le ""garage"""');
    expect(csvCell('ligne 1\nligne 2', 'fr')).toBe('"ligne 1\nligne 2"');
    expect(csvCell(' espace ', 'fr')).toBe('" espace "');
    expect(csvCell(null, 'fr')).toBe('');
  });
  it('text that looks like a formula stays text', () => {
    expect(csvCell('=SUM(A1:A9)', 'en')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1 514 555-0141', 'fr')).toBe("'+1 514 555-0141");
    expect(csvCell('@cmd', 'fr')).toBe("'@cmd");
    expect(csvCell('-2+3', 'fr')).toBe("'-2+3");
  });
  it('amounts are never treated as formulas, negative ones included', () => {
    expect(csvCell({ cents: -1000 }, 'fr')).toBe('-10,00');
    expect(csvCell({ cents: 5 }, 'en')).toBe('0.05');
    expect(centsText(123456, 'fr')).toBe('1234,56');
  });
});
