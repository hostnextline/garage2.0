import { describe, it, expect } from 'vitest';
import { ARTICLES, INFO_TOPICS } from './articles';
import { searchInfo, fold } from './search';

describe('Info: the articles', () => {
  it('each one complete in French and English, with steps and an example, ids unique', () => {
    const ids = new Set<string>();
    for (const a of ARTICLES) {
      expect(ids.has(a.id)).toBe(false); ids.add(a.id);
      expect(INFO_TOPICS).toContain(a.topic);
      for (const l of ['fr', 'en'] as const) {
        const x = a[l];
        expect(x.title.length, `${a.id} ${l}`).toBeGreaterThan(3);
        expect(x.short.length).toBeGreaterThan(10);
        expect(x.steps.length).toBeGreaterThan(0);
        expect(x.example.length).toBeGreaterThan(20);
      }
      expect(a.fr.steps.length).toBe(a.en.steps.length);
    }
    for (const t of INFO_TOPICS) expect(ARTICLES.some((a) => a.topic === t)).toBe(true);
  });
});

describe('Info: the search', () => {
  const top = (q: string, l: 'fr' | 'en' = 'fr') => searchInfo(ARTICLES, q, l)[0]?.id;
  it('a phone number or a symbol typed never breaks the screen (« +1 438… », « (tps) », « * »)', () => {
    for (const q of ['+1 438 901-6606', '+tps', '(tps)', '* vidange', 'a[b', 'c\\d', 'e|f', 'g$h', '^i', '{j}']) {
      expect(() => searchInfo(ARTICLES, q, 'fr')).not.toThrow();
      expect(() => searchInfo(ARTICLES, q, 'en')).not.toThrow();
    }
  });
  it('accents and capitals do not count', () => {
    expect(fold('Équipe « Été »')).toBe('equipe ete');
    expect(top('COFFRE')).toBe('coffre');
    expect(top('famille amis')).toBe('coffre');
  });
  it('finds the right procedure from the words people type', () => {
    expect(top('mettre en premier')).toBe('stop-order');
    expect(top('client absent')).toBe('cancel');
    expect(top('monnaie comptant')).toBe('pay');
    expect(top('huile filtre')).toBe('car-first');
    expect(top('reserver')).toBe('book');
    expect(top('suivi camion')).toBe('tracking');
    expect(top('installer iphone')).toBe('install');
    expect(top('family friends', 'en')).toBe('coffre');
  });
  it('every word must be found; nothing typed shows everything; a topic narrows', () => {
    expect(searchInfo(ARTICLES, 'coffre zzzz', 'fr')).toEqual([]);
    expect(searchInfo(ARTICLES, '  ', 'fr')).toHaveLength(ARTICLES.length);
    expect(searchInfo(ARTICLES, '', 'fr', 'pay').every((a) => a.topic === 'pay')).toBe(true);
  });
});
