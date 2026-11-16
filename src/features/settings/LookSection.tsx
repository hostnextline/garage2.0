/* Apparence (owner): the team's look. The swatches and the choices themselves are shared with « Mon compte » (shared/look/LookChoices.tsx). */
import { t } from '../../lib/i18n';
import { saveSettings } from '../../data/api';
import { settings } from '../../data/select';
import { teamLook, myLook, type Look } from '../../services/theme';
import { Panel, Banner, Button, attempt } from '../../ui';
import { ThemeSwatches, LookChoices } from '../../shared/look/LookChoices';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';

export function LookSection() {
  const saved: Look = teamLook.value;
  const { draft: d, set, dirty, changes, reset } = useSectionDraft<Look>('look', saved);
  const save = async () => {
    if (await attempt(() => saveSettings('appearance', { ...(settings.value.appearance || {}), ...changes }), { ok: t('settings.saved') })) reset();
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
