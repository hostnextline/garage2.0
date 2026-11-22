/* Reading the references written by people: an oil grade (« 5W-30 »), a part number, a tire size and season, litres.
   Shared by the week's needs, the car's facts and the stock's matching. Pure (tested in refs.test.ts). */
import { fold } from '../../lib/text';

/* an engine oil grade: « 5W-30 », « 5w30 », « 5 W 30 ». The number before the W is read whole, so 15W-40 is never 5W-40 */
const GRADE = /(\d{1,2})\s*w\s*-?\s*(\d{2})/i;
const GRADES = new RegExp(GRADE.source, 'gi');
const gradeOf = (m: RegExpExecArray | RegExpMatchArray) => `${Number(m[1])}W-${m[2]}`;

/** « 5W-30 », « 5w30 », « SAE 5W-30 synthétique » → 5W-30; the approval in brackets is kept apart (« VW 502 00 ») */
export function oilGrade(text: string | null | undefined): { grade: string | null; spec: string | null } {
  const s = String(text || '');
  const m = GRADE.exec(s);
  const spec = /\(([^)]+)\)/.exec(s)?.[1]?.trim() || null;
  return { grade: m ? gradeOf(m) : null, spec };
}
/** every oil grade written in a text, each once: « Huile 15W-40 diesel » → ['15W-40'] (never '5W-40') */
export function gradesIn(text: string | null | undefined): string[] {
  return [...new Set([...String(text || '').matchAll(GRADES)].map(gradeOf))];
}
/** a part number to compare: « 06K 115 562 (06L 115 562 B from 04/2018) » → « 06K 115 562 » */
export function partRef(text: string | null | undefined): string | null {
  const s = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return alnum(s).length >= 3 ? s : null;
}
/** « 225/65R17 », « P225/65 R 17 », « 225 65 17 » → 225/65R17 */
export function tireSize(text: string | null | undefined): string | null {
  const m = /(\d{3})\s*[/\s-]\s*(\d{2})\s*(?:Z?R|-|\s)\s*(\d{2}(?:[.,]5)?)/i.exec(String(text || ''));
  return m ? `${m[1]}/${m[2]}R${m[3].replace(',', '.')}` : null;
}
/** the season said in words: « hiver », « été », « 4 saisons » */
export function seasonOf(text: string | null | undefined): 'winter' | 'summer' | 'all' | null {
  const s = fold(text);
  if (/hiver|winter|neige|snow/.test(s)) return 'winter';
  if (/4\s*saisons|quatre saisons|toutes saisons|all.?season/.test(s)) return 'all';
  if (/\bete\b|summer/.test(s)) return 'summer';
  return null;
}
/** litres written in a name: « Changement d'huile (5 L) » → 5, « Bidon 4,4 L » → 4.4, « 946 ml » → 0.946.
    The oil grade is taken out first: in « Huile 0W-20 L » the 20 is the grade, not 20 litres */
export function litresIn(text: string | null | undefined): number | null {
  const s = String(text || '').replace(GRADES, ' ');
  const ml = /(\d{2,4})\s*ml\b/i.exec(s);
  if (ml) return Number(ml[1]) / 1000;
  const l = /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:l|litres?|liters?)\b/i.exec(s);
  return l ? Number(l[1].replace(',', '.')) : null;
}
/** letters and digits only, no accents: « 06K 115 562 » → « 06k115562 » (to compare references) */
export function alnum(s: string | null | undefined): string {
  return fold(s).replace(/[^a-z0-9]/g, '');
}
