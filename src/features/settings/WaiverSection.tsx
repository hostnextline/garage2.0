/* Autorisation: the text the customer reads and signs before the work, in French and English. Changing the text makes
   a new version (signatures already made keep the version they signed). */
import { useState } from 'preact/hooks';
import { t, type Lang } from '../../lib/i18n';
import { settings, garageName } from '../../data/select';
import { saveSettings } from '../../data/api';
import { Panel, Tabs, Textarea, Banner, Pill, Help, attempt } from '../../ui';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';
import { nextVersion, sameValue } from './draft';

interface Waiver { fr: string; en: string }

export function WaiverSection() {
  const w = settings.value.waiver || { version: '1', fr: '', en: '' };
  const saved: Waiver = { fr: w.fr || '', en: w.en || '' };
  const { draft: d, set, dirty, reset } = useSectionDraft<Waiver>('waiver', saved);
  const [l, setL] = useState<Lang>('fr');
  const version = String(w.version || '1');
  const changed = !sameValue(saved, d);
  const save = async () => {
    const ok = await attempt(() => saveSettings('waiver', { ...w, version: changed ? nextVersion(version) : version, fr: d.fr.trim(), en: d.en.trim() }), { ok: t('settings.saved') });
    if (ok) reset();
  };
  const text = d[l];
  const shown = text.replace(/\{garage\}/g, garageName.value);
  return (
    <Section testid="settings-waiver" bar={<SaveBar dirty={dirty} onSave={save} onReset={reset} />}>
      <p class="muted" style={{ margin: 0 }}>{t('settings.waiver.lead')}</p>
      <Panel title={t('settings.waiver.text')} action={<span class="row" style={{ gap: '6px' }}><Pill tone="muted" dot={false}>{t('settings.waiver.version', { v: version })}</Pill><Help text={t('settings.waiver.versionHelp')} /></span>}>
        <div class="stack">
          <Tabs value={l} onValue={setL} label={t('settings.waiver.text')} tabs={[{ value: 'fr', label: t('settings.langFr') }, { value: 'en', label: t('settings.langEn') }]} />
          <label class="field">
            <span class="sr-only">{t('settings.waiver.text')} ({l === 'en' ? t('settings.langEn') : t('settings.langFr')})</span>
            <Textarea value={text} onValue={(v) => set((x) => ({ ...x, [l]: v }))} rows={11} lang={l === 'en' ? 'en-CA' : 'fr-CA'} data-testid="waiver-text" />
          </label>
          {!text.trim() && <Banner kind="warn">{t('settings.waiver.empty')}</Banner>}
          {changed && <Banner kind="info" data-testid="waiver-next">{t('settings.waiver.next', { v: nextVersion(version) })}</Banner>}
        </div>
      </Panel>
      {text.trim() && (
        <Panel title={t('settings.waiver.preview')}>
          <div class="settings-paper" lang={l === 'en' ? 'en-CA' : 'fr-CA'}>{shown}</div>
        </Panel>
      )}
    </Section>
  );
}
