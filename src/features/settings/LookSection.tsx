/* Apparence (owner): the team's look — the theme (H.I.S or a luxury one) as big swatches, light/dark/auto for H.I.S,
   the glass. ThemeSwatches and LookChoices are also used by « Mon compte » (each person's own look). */
import { t, lang } from '../../lib/i18n';
import { saveSettings } from '../../data/api';
import { settings } from '../../data/select';
import { THEMES, teamLook, myLook, type Look, type ThemeKey, type Mode, type Glass } from '../../app/theme';
import { Panel, Seg, Field, Banner, Button, attempt } from '../../ui';
import { HIS_NIGHT, HIS_DAY } from '../../app/backdrop';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';

/* the looks as small showrooms: H.I.S three times (light, dark, automatic: follows the phone), then the luxury themes */
interface LookCard { key: string; theme: ThemeKey; mode?: Mode; swatch: [string, string, string]; split?: [string, string, string]; photo?: string; splitPhoto?: string }
const HIS_LIGHT: [string, string, string] = ['#E7EAEE', '#FFFFFF', '#D3000E'];
const HIS_DARK: [string, string, string] = ['#000000', '#15181B', '#FF2E36'];
export const LOOK_CARDS: LookCard[] = [
  { key: 'his-light', theme: 'his', mode: 'light', swatch: HIS_LIGHT, photo: HIS_DAY },
  { key: 'his-dark', theme: 'his', mode: 'dark', swatch: HIS_DARK, photo: HIS_NIGHT },
  { key: 'his-auto', theme: 'his', mode: 'auto', swatch: HIS_LIGHT, split: HIS_DARK, photo: HIS_DAY, splitPhoto: HIS_NIGHT },
  ...THEMES.filter((th) => th.key !== 'his').map((th) => ({ key: th.key, theme: th.key, swatch: th.swatch }))
];
/** which card is the look */
export function cardOf(l: Pick<Look, 'theme' | 'mode'>): string {
  return l.theme === 'his' ? `his-${l.mode}` : l.theme;
}
function cardName(c: LookCard): string {
  if (c.theme === 'his') return t(`settings.look.his.${c.mode}`);
  const th = THEMES.find((x) => x.key === c.theme)!;
  return lang.value === 'en' ? th.en : th.fr;
}
function cardSub(c: LookCard): string {
  if (c.theme === 'his') return t(`settings.look.his.${c.mode}Sub`);
  const th = THEMES.find((x) => x.key === c.theme)!;
  return th.fixed === 'light' ? t('settings.look.alwaysLight') : t('settings.look.alwaysDark');
}
function Art(p: { s: [string, string, string]; photo?: string }) {
  return (
    <span class={`settings-theme-art${p.photo ? ' has-photo' : ''}`} style={{ '--s0': p.s[0], '--s1': p.s[1], '--s2': p.s[2], ...(p.photo ? { backgroundImage: `url("${p.photo}")` } : {}) }} aria-hidden="true">
      <span class="settings-theme-glow" />
      <span class="settings-theme-panel"><span class="settings-theme-dot" /><span class="settings-theme-line" /><span class="settings-theme-line is-short" /></span>
    </span>
  );
}
export function ThemeSwatches(p: { value: Pick<Look, 'theme' | 'mode'>; onLook: (l: Partial<Look>) => void; label: string; 'data-tour'?: string }) {
  const cur = cardOf(p.value);
  return (
    <div class="settings-themes" role="radiogroup" aria-label={p.label} data-tour={p['data-tour']}>
      {LOOK_CARDS.map((c) => {
        const on = cur === c.key;
        return (
          <button key={c.key} type="button" role="radio" aria-checked={on} class="settings-theme" data-testid={`theme-${c.key}`}
            onClick={() => p.onLook(c.mode ? { theme: c.theme, mode: c.mode } : { theme: c.theme })}>
            {c.split
              ? <span class="settings-theme-split"><Art s={c.swatch} photo={c.photo} /><Art s={c.split} photo={c.splitPhoto} /></span>
              : <Art s={c.swatch} photo={c.photo} />}
            <span class="settings-theme-name">{cardName(c)}</span>
            <span class="settings-theme-mode">{cardSub(c)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** the glass (light and dark are chosen with the cards above) */
export function LookChoices(p: { look: Look; onLook: (l: Partial<Look>) => void }) {
  return (
    <Field label={t('settings.look.glass')} help={t('settings.look.glassHelp')} group>
      <Seg value={p.look.glass} onValue={(v) => p.onLook({ glass: v as Glass })} label={t('settings.look.glass')} data-testid="look-glass"
        options={(['auto', 'on', 'off'] as Glass[]).map((g) => ({ value: g, label: t(`settings.look.glasses.${g}`) }))} />
    </Field>
  );
}

export function LookSection() {
  const saved: Look = teamLook.value;
  const { draft: d, set, dirty, reset } = useSectionDraft<Look>('look', saved);
  const save = async () => {
    if (await attempt(() => saveSettings('appearance', { ...(settings.value.appearance || {}), theme: d.theme, mode: d.mode, glass: d.glass }), { ok: t('settings.saved') })) reset();
  };
  return (
    <Section testid="settings-look" bar={<SaveBar dirty={dirty} onSave={save} onReset={reset} />}>
      <p class="muted" style={{ margin: 0 }}>{t('settings.look.lead')}</p>
      {myLook.value && <Banner kind="info" action={<Button size="sm" href="#/account">{t('settings.look.mineLink')}</Button>}>{t('settings.look.mine')}</Banner>}
      <Panel title={t('settings.look.theme')} help={t('settings.look.themeHelp')}>
        <ThemeSwatches value={d} onLook={(l) => set((x) => ({ ...x, ...l }))} label={t('settings.look.theme')} />
      </Panel>
      <Panel>
        <LookChoices look={d} onLook={(l) => set((x) => ({ ...x, ...l }))} />
      </Panel>
    </Section>
  );
}
