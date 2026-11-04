/* The look: a theme (H.I.S or a luxury one), light/dark for H.I.S, the glass (transparency), and what is behind the
   glass (the H.I.S picture, or my own photo on this device: backdrop.ts).
   The owner picks the team's look in Réglages; each person can keep their own in « Mon compte ».
   Kept on the device so the app opens in the right colours before anything loads. */
import { signal, computed, effect } from '@preact/signals';
import { access } from '../data/auth';
import { settings } from '../data/select';
import { updateMe } from '../data/api';
import { myPhoto, applyBackdrop } from './backdrop';

export type ThemeKey = 'his' | 'platine' | 'or' | 'emeraude' | 'saphir' | 'bordeaux';
export type Mode = 'auto' | 'light' | 'dark';
export type Glass = 'auto' | 'on' | 'off';
export interface Look { theme: ThemeKey; mode: Mode; glass: Glass }

export const THEMES: { key: ThemeKey; fr: string; en: string; fixed?: 'light' | 'dark'; swatch: [string, string, string] }[] = [
  { key: 'his', fr: 'H.I.S', en: 'H.I.S', swatch: ['#000000', '#C4C8CD', '#FF2E36'] },
  { key: 'platine', fr: 'Platine', en: 'Platinum', fixed: 'light', swatch: ['#DCDFE3', '#FBFBFC', '#1E2329'] },
  { key: 'or', fr: 'Noir et or', en: 'Black and gold', fixed: 'dark', swatch: ['#050505', '#16140F', '#D4AF63'] },
  { key: 'emeraude', fr: 'Émeraude', en: 'Emerald', fixed: 'dark', swatch: ['#03110D', '#0B201A', '#D4AF63'] },
  { key: 'saphir', fr: 'Saphir', en: 'Sapphire', fixed: 'dark', swatch: ['#020814', '#0B1630', '#C4C8CD'] },
  { key: 'bordeaux', fr: 'Bordeaux', en: 'Burgundy', fixed: 'dark', swatch: ['#0E0306', '#230A10', '#D4AF63'] }
];
const DEFAULT: Look = { theme: 'his', mode: 'auto', glass: 'auto' };
const KEY = 'his.look';
const isTheme = (x: unknown): x is ThemeKey => THEMES.some((t) => t.key === x);

function clean(x: Partial<Look> | null | undefined, base: Look = DEFAULT): Look {
  return {
    theme: isTheme(x?.theme) ? x!.theme! : base.theme,
    mode: x?.mode === 'light' || x?.mode === 'dark' || x?.mode === 'auto' ? x.mode : base.mode,
    glass: x?.glass === 'on' || x?.glass === 'off' || x?.glass === 'auto' ? x.glass : base.glass
  };
}
function stored(): Look | null { try { const s = localStorage.getItem(KEY); return s ? clean(JSON.parse(s)) : null; } catch { return null; } }

/** the team's look (Réglages) */
export const teamLook = computed<Look>(() => clean(settings.value.appearance as Partial<Look>));
/** my own choice, if I made one */
export const myLook = computed<Look | null>(() => {
  const p = (access.value?.prefs as { look?: Partial<Look> } | undefined)?.look;
  return p ? clean(p, teamLook.value) : null;
});
const deviceLook = signal<Look | null>(stored());
export const look = computed<Look>(() => myLook.value || (access.value ? teamLook.value : deviceLook.value || DEFAULT));

const dark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const phoneDark = signal(!!dark?.matches);
dark?.addEventListener?.('change', (e) => { phoneDark.value = e.matches; });

export function resolvedMode(l: Look): 'light' | 'dark' {
  const th = THEMES.find((x) => x.key === l.theme);
  if (th?.fixed) return th.fixed;
  return l.mode === 'auto' ? (phoneDark.value ? 'dark' : 'light') : l.mode;
}

export function startTheme() {
  effect(() => {
    const l = look.value;
    const root = document.documentElement;
    root.dataset.theme = l.theme;
    root.dataset.mode = resolvedMode(l);
    if (l.glass === 'auto') delete root.dataset.glass; else root.dataset.glass = l.glass;
    applyBackdrop(root, myPhoto.value);
    try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* ignore */ }
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || '#000000';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = bg;
  });
}
/** my own look (null: follow the team's) */
export async function setMyLook(l: Partial<Look> | null) {
  const a = access.value;
  if (!a) return;
  const next = l ? clean({ ...(myLook.value || teamLook.value), ...l }) : null;
  const prefs = { ...(a.prefs || {}), look: next };
  access.value = { ...a, prefs };
  await updateMe({ prefs: { look: next } });
}
