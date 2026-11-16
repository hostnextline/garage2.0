/* French (the app's own language) and English, by message keys.
   Each person picks a language; the first time, it is the phone's. A customer's texts, page and invoice use the
   language on the customer's file. Dictionaries live in src/i18n/fr and src/i18n/en; en must have every key of fr
   (TypeScript checks it), and i18n.test.ts checks that every {placeholder} is the same in both. */
import { signal } from '@preact/signals';
import { fr } from '../i18n/fr';
import { en } from '../i18n/en';

export type Lang = 'fr' | 'en';
type Dict = typeof fr;
const DICTS: Record<Lang, Dict> = { fr, en };

const KEY = 'his.lang';
/** the language at start: the one the person chose on this phone, else « l=en » in the link (a customer's), else the phone's */
export function startLang(): Lang {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'fr' || s === 'en') return s;
  } catch { /* private mode: no saved choice, the link or the phone decides */ }
  const h = /[#&?]l=(en|fr)\b/.exec(String(globalThis.location?.hash || '') + String(globalThis.location?.search || ''));
  if (h) return h[1] as Lang;
  const n = (globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'fr');
  return /^en/i.test(n) ? 'en' : 'fr';
}

export const lang = signal<Lang>(startLang());

export function setLang(l: Lang) {
  lang.value = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode: the choice holds for this visit only */ }
  document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
}

type Vars = Record<string, string | number | null | undefined>;

function walk(d: unknown, path: string): unknown {
  let cur: unknown = d;
  for (const p of path.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}
// t() runs thousands of times per screen: each key is walked once per language, then remembered (the dictionaries never change)
const found: Record<Lang, Map<string, unknown>> = { fr: new Map(), en: new Map() };
function lookup(l: Lang, key: string): unknown {
  const seen = found[l];
  if (seen.has(key)) return seen.get(key);
  let v = walk(DICTS[l], key);
  if (v === undefined && l !== 'fr') v = walk(DICTS.fr, key);
  seen.set(key, v);
  return v;
}

function render(v: unknown, vars: Vars | undefined, l: Lang): string {
  if (v && typeof v === 'object') {
    const n = Number(vars?.n ?? 0);
    const forms = v as Record<string, string>;
    // French says « 1,5 heure » (singular below 2), English « 1.5 hours »
    v = (n === 0 && forms.zero) || (Math.abs(n) === 1 || (l === 'fr' && Math.abs(n) < 2) ? forms.one : forms.other) || forms.other;
  }
  let s = String(v);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return s;
}

/** t('job.next.leave') ; t('agenda.jobsToday', { n: 3 }) ; plural forms: { one: '…', other: '…' } chosen by vars.n.
    A key with no words in either language comes back as the key itself. */
export function t(key: string, vars?: Vars, l: Lang = lang.value): string {
  const v = lookup(l, key);
  return v === undefined ? key : render(v, vars, l);
}
/** the same, or undefined when the dictionaries have no words for this key (a code from the server, a kind from the data):
    the caller then shows its own fallback instead of comparing the answer with the key */
export function tMaybe(key: string, vars?: Vars, l: Lang = lang.value): string | undefined {
  const v = lookup(l, key);
  return v === undefined ? undefined : render(v, vars, l);
}
/** the same, in a given language (customer messages, invoices) */
export function tl(l: Lang, key: string, vars?: Vars): string { return t(key, vars, l); }

export function dictKeys(d: unknown = fr, prefix = ''): string[] {
  const out: string[] = [];
  if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !('one' in (v as object) && 'other' in (v as object))) out.push(...dictKeys(v, p));
      else out.push(p);
    }
  }
  return out;
}
export { DICTS };
