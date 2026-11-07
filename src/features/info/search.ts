/* « Info »: finding an article. Accents and capitals do not count; every word typed must be found somewhere in the
   article; the title counts most, then the words people type (keys), the short answer, then the steps and the
   example. Pure: tested in search.test.ts. */
import type { InfoArticle, InfoText, InfoTopic } from './articles';

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'«»“”"().,;:!?/]/g, ' ').replace(/\s+/g, ' ').trim();
}
const WEIGHTS: [keyof InfoText, number][] = [['title', 8], ['keys', 5], ['short', 3], ['steps', 1], ['example', 1], ['tips', 1]];
const textOf = (x: InfoText, k: keyof InfoText) => fold(Array.isArray(x[k]) ? (x[k] as string[]).join(' ') : String(x[k] ?? ''));

/** articles matching the words (in the language shown), best first; no words: all of them in their order */
export function searchInfo(list: InfoArticle[], q: string, lang: 'fr' | 'en', topic: InfoTopic | null = null): InfoArticle[] {
  const pool = topic ? list.filter((a) => a.topic === topic) : list;
  const words = fold(q).split(' ').filter((w) => w.length > 1);
  if (!words.length) return pool;
  const scored: { a: InfoArticle; s: number; i: number }[] = [];
  pool.forEach((a, i) => {
    // the other language helps too (an English word typed on the French app), at a lower weight
    const own = a[lang], other = a[lang === 'fr' ? 'en' : 'fr'];
    let s = 0;
    for (const w of words) {
      let best = 0;
      for (const [k, wt] of WEIGHTS) {
        const t = textOf(own, k);
        if (t.includes(w)) best = Math.max(best, wt * (new RegExp(`\\b${w}`).test(t) ? 2 : 1));
      }
      if (!best) for (const [k] of WEIGHTS) if (textOf(other, k).includes(w)) { best = 1; break; }
      if (!best) return;          // every word must be somewhere
      s += best;
    }
    scored.push({ a, s, i });
  });
  return scored.sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.a);
}
