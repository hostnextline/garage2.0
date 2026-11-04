/* French (the app's own language) and English, by message keys.
   Each person picks a language; the first time, it is the phone's. A customer's texts, page and invoice use the
   language on the customer's file. Dictionaries live in src/i18n/fr.ts and en.ts; en must have every key of fr
   (TypeScript checks it), and a test checks that every {placeholder} is the same in both. */
import { signal, computed } from '@preact/signals';
import { fr } from '../i18n/fr';
import { en } from '../i18n/en';

export type Lang = 'fr' | 'en';
type Dict = typeof fr;
const DICTS: Record<Lang, Dict> = { fr, en };

const KEY = 'his.lang';
function initial(): Lang {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'fr' || s === 'en') return s;
  } catch { /* private mode */ }
  const h = /[#&?]l=(en|fr)\b/.exec(String(globalThis.location?.hash || '') + String(globalThis.location?.search || ''));
  if (h) return h[1] as Lang;
  const n = (globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'fr');
  return /^en/i.test(n) ? 'en' : 'fr';
}

export const lang = signal<Lang>(initial());
export const isEn = computed(() => lang.value === 'en');

export function setLang(l: Lang) {
  lang.value = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
}

type Vars = Record<string, string | number | null | undefined>;

function lookup(d: unknown, path: string): unknown {
  let cur: unknown = d;
  for (const p of path.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

/** t('job.next.leave') ; t('agenda.jobsToday', { n: 3 }) ; plural forms: { one: '…', other: '…' } chosen by vars.n */
export function t(key: string, vars?: Vars, l: Lang = lang.value): string {
  let v = lookup(DICTS[l], key);
  if (v === undefined && l !== 'fr') v = lookup(DICTS.fr, key);
  if (v === undefined) return key;
  if (v && typeof v === 'object') {
    const n = Number(vars?.n ?? 0);
    const forms = v as Record<string, string>;
    v = (n === 0 && forms.zero) || (Math.abs(n) === 1 || (l === 'fr' && Math.abs(n) < 2) ? forms.one : forms.other) || forms.other;
  }
  let s = String(v);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return s;
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
