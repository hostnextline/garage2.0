/* « Info » and the real roads (Part 27): a sentence true only with the estimate of before has its twin, chosen by the
   garage's switch (settings.booking.roads_on), in both languages. */
import { describe, it, expect } from 'vitest';
import { ARTICLES, articleText } from './articles';
import { searchInfo } from './search';

const far = ARTICLES.find((a) => a.id === 'far')!;
const words = (x: ReturnType<typeof articleText>) => [x.title, x.short, ...x.steps, x.example, ...(x.tips || [])].join(' ');

describe('Info: the article on the driving, with the real roads on or off', () => {
  it('off: the text of before (the estimate); on: the real roads with the traffic of the hour and the unknown time', () => {
    // off: the estimate, said without straight-line words (CONTRACT §0: none « switch on OR off »; review R10)
    expect(articleText(far, 'fr', false).tips).toContain('La route est une estimation (« Le calcul de la route », Réglages → Réservations), pas la circulation réelle.');
    expect(articleText(far, 'en', false).tips).toContain('The driving is an estimate (“Route estimate”, Settings → Bookings), not real traffic.');
    const fr = articleText(far, 'fr', true), en = articleText(far, 'en', true);
    expect(fr.tips!.join(' ')).toContain('vraies routes (TomTom), avec la circulation habituelle de l’heure');
    expect(fr.tips!.join(' ')).toContain('Trajet inconnu');
    expect(fr.tips!.join(' ')).toContain('sans la clé de TomTom, les vraies rues sans la circulation');
    expect(en.tips!.join(' ')).toContain('without TomTom’s key, the real streets without traffic');
    expect(en.tips!.join(' ')).toContain('real roads (TomTom), with the usual traffic of the hour');
    expect(en.tips!.join(' ')).toContain('Unknown drive');
    // the rest of the article is the same
    expect([fr.title, fr.short, fr.steps, fr.example]).toEqual([far.fr.title, far.fr.short, far.fr.steps, far.fr.example]);
    expect(fr.tips!.length).toBe(far.fr.tips!.length);
  });
  it('on OR off: no article, in either language, says the road is a straight-line estimate (CONTRACT §0)', () => {
    for (const a of ARTICLES) for (const l of ['fr', 'en'] as const) for (const on of [true, false]) {
      expect(words(articleText(a, l, on)), `${a.id} ${l} ${on}`).not.toMatch(/vol d.oiseau|crow flies|ligne droite|straight line/i);
    }
  });
  it('an article without a twin is the same on and off', () => {
    const other = ARTICLES.find((a) => a.id !== 'far' && !a.fr.roads)!;
    expect(articleText(other, 'fr', true)).toBe(other.fr);
  });
  it('the search reads the text shown: « TomTom » finds the article only with the real roads on', () => {
    expect(searchInfo(ARTICLES, 'tomtom circulation', 'fr', null, true)[0]?.id).toBe('far');
    expect(searchInfo(ARTICLES, 'tomtom circulation', 'fr', null, false).map((a) => a.id)).not.toContain('far');
    expect(searchInfo(ARTICLES, 'estimation calcul', 'fr', null, false).map((a) => a.id)).toContain('far');
    expect(searchInfo(ARTICLES, 'estimation calcul', 'fr', null, true).map((a) => a.id)).not.toContain('far');
  });
});

describe('Info: « Prendre un rendez-vous » with the real roads on (decision 7, final-guess G3)', () => {
  const book = ARTICLES.find((a) => a.id === 'book')!;
  it('on: the time comes from the real roads and a drive not measured counts a fixed time (never « exacte »); off: as before', () => {
    expect(articleText(book, 'fr', false).tips![0]).toMatch(/exacte/);
    const fr = articleText(book, 'fr', true).tips!.join(' '), en = articleText(book, 'en', true).tips!.join(' ');
    expect(fr).toContain('vraies routes');
    expect(fr).toContain('pas encore mesuré');
    expect(fr).not.toMatch(/exacte/);
    expect(en).toContain('real roads');
    expect(en).toContain('not measured yet');
    expect(articleText(book, 'fr', true).tips!.length).toBe(book.fr.tips!.length);
  });
});
