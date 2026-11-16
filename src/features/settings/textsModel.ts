/* Réglages → Textos, the rules without the screen (textsModel.test.ts). The form holds one field per switch and per
   text (« on.booking », « fr.booking », « en.booking »), so a save writes only the switches and texts the person
   changed: flipping one switch no longer writes the 22 texts, nor freezes a starting text into the settings
   (settings-team-21a). */
import type { Settings } from '../../data/types';
import { DEFAULT_ON, DEFAULT_TEXTS, SWITCH_OF, type MsgKind } from './messages';

export type TextsView = Record<string, string | boolean>;
const onKey = (sw: string) => `on.${sw}`;
export const textKey = (l: 'fr' | 'en', k: MsgKind) => `${l}.${k}`;

/** the switches and texts of the kinds shown, as stored (or as the server would use them when never set) */
export function viewOf(m: Settings['messages'] | null | undefined, kinds: readonly MsgKind[]): TextsView {
  const v: TextsView = {};
  for (const k of kinds) {
    const sw = SWITCH_OF[k];
    if (sw === k) v[onKey(sw)] = typeof m?.on?.[sw] === 'boolean' ? m.on[sw] : DEFAULT_ON[sw];
    v[textKey('fr', k)] = m?.fr?.[k] ?? DEFAULT_TEXTS.fr[k];
    v[textKey('en', k)] = m?.en?.[k] ?? DEFAULT_TEXTS.en[k];
  }
  return v;
}
export const switchOn = (v: TextsView, k: MsgKind) => v[onKey(SWITCH_OF[k])] !== false;
export const flipSwitch = (v: TextsView, k: MsgKind): TextsView => ({ ...v, [onKey(SWITCH_OF[k])]: !switchOn(v, k) });
export const textOf = (v: TextsView, l: 'fr' | 'en', k: MsgKind) => String(v[textKey(l, k)] ?? '');

/** the stored `messages` with only the changed switches and texts set on it (texts trimmed) */
export function patchOf(changes: Partial<TextsView>, m: Settings['messages'] | null | undefined): Settings['messages'] {
  const out = { ...(m || {}), on: { ...(m?.on || {}) }, fr: { ...(m?.fr || {}) }, en: { ...(m?.en || {}) } } as Settings['messages'];
  for (const [key, val] of Object.entries(changes)) {
    const [part, kind] = key.split('.') as ['on' | 'fr' | 'en', string];
    if (part === 'on') out.on[kind] = val === true;
    else out[part][kind] = String(val ?? '').trim();
  }
  return out;
}
