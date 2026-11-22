/* Which language the app speaks on this device: the person's own choice on this device (sign-in screen, invitation,
   Mon compte: kept as his.lang), else their account's language once known, else the phone's. The guess from the phone
   is never written down: written, it looked like a choice and the account's language never came (tested in lang.test.ts). */
import { lang, type Lang } from '../lib/i18n';

const KEY = 'his.lang';
export function storedLang(): Lang | null {
  try { const s = localStorage.getItem(KEY); return s === 'fr' || s === 'en' ? s : null; } catch { return null; }
}
/** the language to show: the device's choice wins, then the account's, then the guess already on screen */
export function pickLang(o: { stored: Lang | null; account: string | null | undefined; guess: Lang }): Lang {
  if (o.stored) return o.stored;
  if (o.account === 'fr' || o.account === 'en') return o.account;
  return o.guess;
}
/** shows a language without writing it down (the account's, or the guess) */
export function showLang(l: Lang) {
  if (lang.value !== l) lang.value = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
}
