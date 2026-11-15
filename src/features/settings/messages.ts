/* The texts sent to customers (supabase/functions/notify and enroute fill them): their kinds, the words replaced
   in each one, the starting texts, and the preview shown while editing. Pure functions (settings.test.ts).
   « Plages d'arrivée » (Part 25): the kind `window` (the text sent when a flexible appointment gets its window, the evening
   before) and the word {plage} (« entre 14 h et 18 h »); the server's twin is supabase/functions/_shared/texts.ts. */
import { clock } from '../../lib/dates';

export type MsgKind = 'booking' | 'moved' | 'en_route' | 'en_route_no_eta' | 'arrived' | 'arrived_no_pay' | 'invoice' | 'extras' | 'reminder' | 'payment_reminder' | 'return_trip' | 'window';
export const MSG_KINDS: MsgKind[] = ['booking', 'moved', 'en_route', 'en_route_no_eta', 'arrived', 'arrived_no_pay', 'extras', 'invoice', 'payment_reminder', 'reminder', 'window', 'return_trip'];
/** the kinds that exist only while the garage books by arrival windows (hidden, and never written to the settings, otherwise) */
export const WINDOW_KINDS: MsgKind[] = ['window'];
export function kindsFor(windowsOn: boolean): MsgKind[] { return MSG_KINDS.filter((k) => windowsOn || !WINDOW_KINDS.includes(k)); }
/** the on/off switch a kind follows (the text « en route » without an arrival time follows « en route »; the same for « arrivé ») */
export const SWITCH_OF: Record<MsgKind, string> = {
  booking: 'booking', moved: 'moved', en_route: 'en_route', en_route_no_eta: 'en_route', arrived: 'arrived', arrived_no_pay: 'arrived',
  invoice: 'invoice', extras: 'extras', reminder: 'reminder', payment_reminder: 'payment_reminder', return_trip: 'return_trip', window: 'window'
};
export const SWITCHES = ['booking', 'moved', 'en_route', 'arrived', 'extras', 'invoice', 'payment_reminder', 'reminder', 'window', 'return_trip'] as const;
/** what the server does when a switch was never set (messages.on[kind] missing) */
export const DEFAULT_ON: Record<string, boolean> = { booking: true, moved: true, en_route: true, arrived: true, extras: true, invoice: true, payment_reminder: true, reminder: false, return_trip: true, window: true };

export const ALL_VARS = ['prenom', 'garage', 'jour', 'bloc', 'debut', 'fin', 'total', 'services', 'soustotal', 'payer', 'lien', 'mecano', 'heure', 'minutes', 'vehicule', 'montant', 'numero', 'date', 'telephone', 'lieu', 'plage'] as const;
export type VarName = (typeof ALL_VARS)[number];
const BASE: VarName[] = ['prenom', 'garage', 'jour', 'debut', 'fin', 'lien', 'telephone'];
/** the words each text really gets from the server (others would come out empty) */
export const VARS_OF: Record<MsgKind, VarName[]> = {
  booking: [...BASE, 'bloc', 'plage', 'services', 'soustotal', 'total'],
  moved: [...BASE, 'bloc', 'plage', 'total'],
  en_route: ['prenom', 'mecano', 'garage', 'heure', 'minutes', 'lien'],
  en_route_no_eta: ['prenom', 'mecano', 'garage', 'lien'],
  arrived: ['prenom', 'mecano', 'garage', 'total', 'montant', 'lien', 'telephone'],
  arrived_no_pay: ['prenom', 'mecano', 'garage', 'total', 'montant', 'lien', 'telephone'],
  extras: [...BASE, 'mecano', 'vehicule', 'montant'],
  invoice: [...BASE, 'numero', 'total', 'montant', 'date'],
  payment_reminder: [...BASE, 'numero', 'total', 'montant', 'date'],
  reminder: [...BASE, 'plage'],
  window: [...BASE, 'plage'],
  return_trip: ['mecano', 'lieu', 'garage', 'heure', 'minutes', 'lien']
};

/* the starting texts (supabase/migrations/…_defaults.sql), for « Remettre le texte d'origine » */
export const DEFAULT_TEXTS: Record<'fr' | 'en', Record<MsgKind, string>> = {
  fr: {
    booking: 'Bonjour {prenom}, votre rendez-vous avec {garage} est confirmé : {jour}, {bloc} (entre {debut} et {fin}).\n\nEstimation :\n{services}\nTotal : {soustotal}\n\nPour accepter l’estimation et autoriser les travaux sur votre véhicule (un seul bouton) : {lien}',
    moved: 'Bonjour {prenom}, votre rendez-vous avec {garage} a changé : {jour}, entre {debut} et {fin}. Détails : {lien}',
    en_route: 'Bonjour {prenom}, {mecano} de {garage} est en route vers chez vous : arrivée prévue vers {heure} (environ {minutes} min). Suivez son trajet en direct : {lien}',
    en_route_no_eta: 'Bonjour {prenom}, {mecano} de {garage} est en route vers chez vous. Suivez son trajet en direct : {lien}',
    arrived: 'Bonjour {prenom}, {mecano} de {garage} est arrivé. Votre facture : {total} taxes incluses. Vous pouvez la payer en ligne pendant les travaux : {lien}',
    arrived_no_pay: 'Bonjour {prenom}, {mecano} de {garage} est arrivé. Votre facture : {total} taxes incluses. Détails : {lien}',
    invoice: 'Bonjour {prenom}, voici votre facture {numero} de {garage} ({total}) : {lien}',
    extras: 'Bonjour {prenom}, {mecano} de {garage} propose des travaux supplémentaires sur votre {vehicule} ({montant} avant taxes). Pour voir et accepter ou refuser : {lien}',
    reminder: 'Rappel : {garage} vient demain, {jour}, entre {debut} et {fin}. Pour changer : {telephone}',
    payment_reminder: 'Bonjour {prenom}, petit rappel de {garage} : la facture {numero} du {date} ({montant}) est toujours à payer. {lien}',
    return_trip: '{mecano} a fini sa journée et revient vers {lieu} : arrivée prévue vers {heure} (environ {minutes} min). Suivre le camion en direct : {lien}',
    window: 'Bonjour {prenom}, votre plage d’arrivée est confirmée : {garage} vient {jour}, {plage}. Pour changer : {telephone}'
  },
  en: {
    booking: 'Hello {prenom}, your appointment with {garage} is confirmed: {jour}, {bloc} (between {debut} and {fin}).\n\nEstimate:\n{services}\nTotal: {soustotal}\n\nTo accept the estimate and authorize the work on your vehicle (one button): {lien}',
    moved: 'Hello {prenom}, your appointment with {garage} has changed: {jour}, between {debut} and {fin}. Details: {lien}',
    en_route: 'Hello {prenom}, {mecano} from {garage} is on the way to you: arriving around {heure} (about {minutes} min). Follow the trip live: {lien}',
    en_route_no_eta: 'Hello {prenom}, {mecano} from {garage} is on the way to you. Follow the trip live: {lien}',
    arrived: 'Hello {prenom}, {mecano} from {garage} has arrived. Your invoice: {total} taxes included. You can pay it online while the work is being done: {lien}',
    arrived_no_pay: 'Hello {prenom}, {mecano} from {garage} has arrived. Your invoice: {total} taxes included. Details: {lien}',
    invoice: 'Hello {prenom}, here is your invoice {numero} from {garage} ({total}): {lien}',
    extras: 'Hello {prenom}, {mecano} from {garage} suggests extra work on your {vehicule} ({montant} before taxes). To see it and accept or decline: {lien}',
    reminder: 'Reminder: {garage} comes tomorrow, {jour}, between {debut} and {fin}. To change: {telephone}',
    payment_reminder: 'Hello {prenom}, a friendly reminder from {garage}: invoice {numero} of {date} ({montant}) is still unpaid. {lien}',
    return_trip: '{mecano} is done for the day and heading back to {lieu}: arriving around {heure} (about {minutes} min). Follow the truck live: {lien}',
    window: 'Hello {prenom}, your arrival window is confirmed: {garage} comes on {jour}, {plage}. To change: {telephone}'
  }
};

/** the word {plage}: « entre 14 h et 18 h »; a flexible appointment with no window yet (null): the whole day, confirmed the evening before */
export function plageWords(win: readonly [number, number] | null, l: 'fr' | 'en'): string {
  if (!win) return l === 'en' ? 'during the day; we confirm a 4-hour window the day before' : 'dans la journée ; nous vous confirmons la veille une plage de 4 heures';
  return l === 'en' ? `between ${clock(win[0], 'en')} and ${clock(win[1], 'en')}` : `entre ${clock(win[0], 'fr')} et ${clock(win[1], 'fr')}`;
}
/** the words about the moment in the example: a job with a window says its window in {debut} {fin} {plage}, and {bloc} says
    « dans la journée » (never a block's name); a job in a block says its block as before */
export function momentVars(o: { window: readonly [number, number] | null; block: readonly [number, number]; blockWords: string; dayWords: string }, l: 'fr' | 'en'): Record<'bloc' | 'debut' | 'fin' | 'plage', string> {
  const r = o.window || o.block;
  return { bloc: o.window ? o.dayWords : o.blockWords, debut: clock(r[0], l), fin: clock(r[1], l), plage: plageWords(r, l) };
}

const TOKEN = /\{(\w+)\}/g;
/** the text as the customer would get it: known words replaced; an unknown {word} stays visible (so a typo shows) */
export function fillPreview(tpl: string, vars: Partial<Record<string, string | number | null | undefined>>): string {
  return String(tpl || '').replace(TOKEN, (m, k: string) => (vars[k] != null ? String(vars[k]) : m)).replace(/\s{2,}/g, ' ').trim();
}
/** the same, in pieces, so the screen can mark the unknown words */
export function previewParts(tpl: string, vars: Partial<Record<string, string | number | null | undefined>>): { text: string; unknown?: string }[] {
  const out: { text: string; unknown?: string }[] = [];
  const s = String(tpl || '').replace(/\s{2,}/g, ' ').trim();
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: s.slice(last, i) });
    const v = vars[m[1]];
    out.push(v != null ? { text: String(v) } : { text: m[0], unknown: m[1] });
    last = i + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  // two text pieces side by side are joined (the screen draws fewer nodes)
  return out.reduce<{ text: string; unknown?: string }[]>((acc, p) => {
    const prev = acc[acc.length - 1];
    if (prev && !prev.unknown && !p.unknown) prev.text += p.text; else acc.push({ ...p });
    return acc;
  }, []);
}
/** the {words} of a text that this kind of text does not get (each once, in order) */
export function unknownVars(tpl: string, allowed: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of String(tpl || '').matchAll(TOKEN)) if (!allowed.includes(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out;
}
/** puts {word} where the cursor is (or replaces the selection); returns the new text and the new cursor */
export function insertAt(text: string, start: number | null | undefined, end: number | null | undefined, word: string): { text: string; cursor: number } {
  const s = String(text || '');
  const a = Math.max(0, Math.min(s.length, start ?? s.length));
  const z = Math.max(a, Math.min(s.length, end ?? a));
  const token = `{${word}}`;
  const before = s.slice(0, a), after = s.slice(z);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  const padAfter = after && !/^[\s,.;:!?)]/.test(after) ? ' ' : '';
  const next = before + pad + token + padAfter + after;
  return { text: next, cursor: (before + pad + token).length };
}
