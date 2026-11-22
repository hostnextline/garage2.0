import { describe, it, expect } from 'vitest';
import { gradesIn, litresIn, oilGrade, alnum } from './refs';
import { litresPerUnit } from './allocate';

describe('oil grades read whole', () => {
  it('15W-40 is not 5W-40, 10W-30 is not 0W-30', () => {
    expect(gradesIn('Huile 15W-40 diesel')).toEqual(['15W-40']);
    expect(gradesIn('huile10w30')).toEqual(['10W-30']);
    expect(gradesIn('Huile 10W-40 / 5W-40 synthétique')).toEqual(['10W-40', '5W-40']);
    expect(gradesIn('Filtre PH7317')).toEqual([]);
    expect(oilGrade('SAE 15W40').grade).toBe('15W-40');
  });
  it('references compared without spaces, accents or case', () => {
    expect(alnum('06K 115 562')).toBe('06k115562');
    expect(alnum('Pneu d’hiver')).toBe('pneudhiver');
  });
});

describe('litres in a name never come from the oil grade', () => {
  it('« Huile 0W-20 L » is not 20 litres a jug, « Huile 5W-30 litre » not 30', () => {
    expect(litresIn('Huile 5W-30 litre')).toBeNull();
    expect(litresIn('Huile 0W-20 L')).toBeNull();
    expect(litresPerUnit({ name: 'Huile 5W-20 L', unit: 'bidon', sku: null })).toBeNull();
    expect(litresPerUnit({ name: 'Huile 5W-40 VW 502 00 bidon 5 L', unit: 'bidon', sku: null })).toBe(5);
    expect(litresIn('Huile 5W30 4,4L')).toBe(4.4);
  });
});
