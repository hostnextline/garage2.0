import { describe, it, expect } from 'vitest';
import { pdfText } from './pdf';

describe('text for the PDF font', () => {
  it('keeps French letters and signs, replaces what the font cannot draw', () => {
    expect(pdfText('Facture payée à l’avance « ok » — 1 234,50 $')).toBe('Facture payée à l’avance « ok » — 1 234,50 $');
    expect(pdfText('−10,00 $')).toBe('-10,00 $');
    expect(pdfText('Merci 🙂')).toBe('Merci ??');
  });
  it('a name with an accent the font does not have loses only the accent', () => {
    expect(pdfText('Nguyễn Văn An')).toBe('Nguyen Van An');
    expect(pdfText('Łukasz Dąbrowski')).toBe('Lukasz Dabrowski');
    expect(pdfText('Ţepeş')).toBe('Tepes');
    expect(pdfText('王')).toBe('?');
  });
});
