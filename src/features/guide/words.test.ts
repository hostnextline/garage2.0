import { describe, it, expect, beforeAll } from 'vitest';
import { gt } from './words';
import { t, dictKeys, lang } from '../../lib/i18n';
import { fr } from '../../i18n/fr';
import { en } from '../../i18n/en';

describe('the guide in both booking modes', () => {
  beforeAll(() => { lang.value = 'fr'; });
  it('blocks: the usual words', () => {
    expect(gt('guide.faq.qa.blocks.what.q', undefined, false)).toBe(t('guide.faq.qa.blocks.what.q'));
    expect(gt('guide.faq.topics.blocks', undefined, false)).toBe('Les blocs');
  });
  it('arrival windows: the twin when there is one, else the usual words', () => {
    expect(gt('guide.faq.topics.blocks', undefined, true)).toBe('Les plages');
    expect(gt('guide.faq.topics.book', undefined, true)).toBe('Réserver');
    expect(gt('guide.faq.qa.blocks.who.q', undefined, true)).toBe(t('guide.faq.qa.blocks.who.q'));
    expect(gt('guide.tour.steps.bookBlock.title', undefined, true)).toBe('La plage d’arrivée');
  });
  it('every twin replaces a text that exists, and never says « bloc » or “slot”', () => {
    for (const [d, bad] of [[fr, /\bblocs?\b/i], [en, /\b(time )?slots?\b|\bblocks?\b/i]] as const) {
      const keys = dictKeys(d);
      const twins = keys.filter((k) => k.startsWith('guide.win.'));
      expect(twins.length).toBeGreaterThan(10);
      for (const k of twins) {
        expect(keys, k).toContain(k.replace('guide.win.', 'guide.'));
        expect(t(k, undefined, d === fr ? 'fr' : 'en'), k).not.toMatch(bad);
      }
    }
  });
});
