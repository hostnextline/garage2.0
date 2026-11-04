/* The words of the customer's page. A tiny t() over the client dictionary only (the team app's i18n would bring
   every dictionary of the app into this light page). Same rules: {name} placeholders, { one, other } plurals. */
import { client as fr } from '../i18n/fr/client';
import { client as en } from '../i18n/en/client';

export type CLang = 'fr' | 'en';
type Vars = Record<string, string | number | null | undefined>;

function lookup(d: unknown, path: string): unknown {
  let cur: unknown = d;
  for (const p of path.split('.')) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

/** the word for `key` in `dicts[l]` (French when English lacks it; the key itself when nobody has it) */
export function translate(dicts: Record<CLang, unknown>, l: CLang, key: string, vars?: Vars): string {
  let v = lookup(dicts[l] ?? dicts.fr, key);
  if (v === undefined && l !== 'fr') v = lookup(dicts.fr, key);
  if (v === undefined) return key;
  if (v && typeof v === 'object') {
    const forms = v as Record<string, string>;
    if (typeof forms.other !== 'string') return key;
    const n = Number(vars?.n ?? 0);
    v = (n === 0 && forms.zero) || ((Math.abs(n) === 1 || (l === 'fr' && Math.abs(n) < 2)) ? forms.one : forms.other) || forms.other;
  }
  let s = String(v);
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return s;
}

const DICTS: Record<CLang, unknown> = { fr, en };
/** ct('fr', 'pay.button', { amount }) */
export function ct(l: CLang, key: string, vars?: Vars): string { return translate(DICTS, l, key, vars); }

export function isLang(x: unknown): x is CLang { return x === 'fr' || x === 'en'; }

/** the page's language: « &l=en » in the link, else the customer's file, else the phone's language */
export function pickLang(fromLink: string | null | undefined, fromData: string | null | undefined, nav: string | null | undefined = globalThis.navigator?.language): CLang {
  if (isLang(fromLink)) return fromLink;
  if (isLang(fromData)) return fromData;
  return /^en\b/i.test(String(nav || '')) ? 'en' : 'fr';
}
