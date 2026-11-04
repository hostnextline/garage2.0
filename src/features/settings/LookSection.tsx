/* Apparence (owner): the team's look — the theme (H.I.S or a luxury one) as big swatches, light/dark/auto for H.I.S,
   the glass. ThemeSwatches and LookChoices are also used by « Mon compte » (each person's own look). */
import { t, lang } from '../../lib/i18n';
import { saveSettings } from '../../data/api';
import { settings } from '../../data/select';
import { THEMES, teamLook, myLook, type Look, type ThemeKey, type Mode, type Glass } from '../../app/theme';
import { Panel, Seg, Field, Banner, Button, attempt } from '../../ui';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';

export function ThemeSwatches(p: { value: ThemeKey; onValue: (k: ThemeKey) => void; label: string; 'data-tour'?: string }) {
  return (
    <div class="settings-themes" role="radiogroup" aria-label={p.label} data-tour={p['data-tour']}>
      {THEMES.map((th) => {
        const on = p.value === th.key;
        return (
          <button key={th.key} type="button" role="radio" aria-checked={on} class="settings-theme" onClick={() => p.onValue(th.key)} data-testid={`theme-${th.key}`}>
            <span class="settings-theme-art" style={{ '--s0': th.swatch[0], '--s1': th.swatch[1], '--s2': th.swatch[2] }} aria-hidden="true">
              <span class="settings-theme-glow" />
              <span class="settings-theme-panel"><span class="settings-theme-dot" /><span class="settings-theme-line" /><span class="settings-theme-line is-short" /></span>
            </span>
            <span class="settings-theme-name">{lang.value === 'en' ? th.en : th.fr}</span>
            <span class="settings-theme-mode">{th.fixed === 'light' ? t('settings.look.alwaysLight') : th.fixed === 'dark' ? t('settings.look.alwaysDark') : t('settings.look.followsPhone')}</span>
          </button>
        );
      })}
    </div>
  );
}

/** the light/dark choice (H.I.S only) and the glass */
export function LookChoices(p: { look: Look; onLook: (l: Partial<Look>) => void }) {
  const th = THEMES.find((x) => x.key === p.look.theme);
  return (
    <div class="grid-2">
      <Field label={t('settings.look.mode')} help={t('settings.look.modeHelp')} group
        hint={th?.fixed ? t('settings.look.fixedMode', { mode: th.fixed === 'light' ? t('settings.look.modes.light').toLowerCase() : t('settings.look.modes.dark').toLowerCase() }) : undefined}>
        <Seg value={th?.fixed ? th.fixed : p.look.mode} onValue={(v) => p.onLook({ mode: v as Mode })} label={t('settings.look.mode')} data-testid="look-mode"
          options={(['auto', 'light', 'dark'] as Mode[]).map((m) => ({ value: m, label: t(`settings.look.modes.${m}`), disabled: !!th?.fixed }))} />
      </Field>
      <Field label={t('settings.look.glass')} help={t('settings.look.glassHelp')} group>
        <Seg value={p.look.glass} onValue={(v) => p.onLook({ glass: v as Glass })} label={t('settings.look.glass')} data-testid="look-glass"
          options={(['auto', 'on', 'off'] as Glass[]).map((g) => ({ value: g, label: t(`settings.look.glasses.${g}`) }))} />
      </Field>
    </div>
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
        <ThemeSwatches value={d.theme} onValue={(k) => set((x) => ({ ...x, theme: k }))} label={t('settings.look.theme')} />
      </Panel>
      <Panel>
        <LookChoices look={d} onLook={(l) => set((x) => ({ ...x, ...l }))} />
      </Panel>
    </Section>
  );
}
