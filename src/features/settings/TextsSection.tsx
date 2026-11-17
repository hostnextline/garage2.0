/* Textos: each text sent to customers, on or off, and its words in French and English (the editor opens under its row). */
import { useState } from 'preact/hooks';
import { Pencil, ChevronUp } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { settings, windowsOn } from '../../data/select';
import { saveSection } from './save';
import { Panel, Button, attempt } from '../../ui';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';
import { shownKinds, flatText, SWITCH_OF, type MsgKind } from './messages';
import { viewOf, patchOf, switchOn, flipSwitch, textOf, type TextsView } from './textsModel';
import { TextEditor } from './TextEditor';

/** the switches and texts shown, as stored now (also what the dot of the list compares the draft with). « Plage
    confirmée » exists only while the garage books by arrival windows. */
export const textsSaved = (): TextsView => viewOf(settings.value.messages, shownKinds(windowsOn.value));

export function TextsSection() {
  const kinds = shownKinds(windowsOn.value);
  const saved = textsSaved();
  const { draft: d, set, dirty, changes, reset } = useSectionDraft<TextsView>('texts', saved);
  const [open, setOpen] = useState<MsgKind | null>(null);
  const shownLang = lang.value === 'en' ? 'en' : 'fr';

  const save = async () => {
    if (await attempt(() => saveSection('messages', patchOf(changes, settings.value.messages)), { ok: t('settings.saved') })) reset();
  };

  return (
    <Section testid="settings-texts" bar={<SaveBar dirty={dirty} onSave={save} onReset={reset} />}>
      <p class="muted" style={{ margin: 0 }}>{t('settings.texts.lead')}</p>
      <Panel flush class="settings-texts">
        <div class="settings-msg-cols" aria-hidden="true">
          <span class="grow small muted">{t('settings.texts.colText')}</span>
          <span class="small muted">{t('settings.texts.auto')}</span>
        </div>
        <div class="rows" role="list">
          {kinds.map((k) => {
            const sw = SWITCH_OF[k];
            const on = switchOn(d, k);
            const isOpen = open === k;
            return (
              <div key={k} role="listitem" class={`settings-msg${isOpen ? ' is-open' : ''}${on ? '' : ' is-off'}`} data-testid={`msg-${k}`}>
                <div class="settings-msg-head">
                  <span class="grow">
                    <b class="settings-msg-title">{t(`settings.texts.kinds.${k}.title`)}</b>
                    <span class="small muted settings-msg-when">{t(`settings.texts.kinds.${k}.when`)}</span>
                  </span>
                  {sw === k
                    ? <span class="settings-msg-switch">
                        <button type="button" role="switch" class="switch" aria-checked={on} aria-label={`${t('settings.texts.auto')}, ${t(`settings.texts.kinds.${k}.title`)}`}
                          data-testid={`msg-on-${k}`} onClick={() => set((x) => flipSwitch(x, k))} /></span>
                    : <span class="small faint settings-msg-follow">{t('settings.texts.follows', { name: t(`settings.texts.kinds.${sw}.title`) })}</span>}
                </div>
                <div class="settings-msg-row">
                  <p class="settings-msg-sample small">{flatText(textOf(d, shownLang, k))}</p>
                  <Button size="sm" variant={isOpen ? 'secondary' : 'ghost'} icon={isOpen ? <ChevronUp size={16} /> : <Pencil size={16} />} onClick={() => setOpen(isOpen ? null : k)}
                    data-testid={`msg-edit-${k}`}>{isOpen ? t('settings.texts.close') : t('settings.texts.edit')}</Button>
                </div>
                {isOpen && <TextEditor kind={k} d={d} set={set} />}
              </div>
            );
          })}
        </div>
      </Panel>
      <p class="small faint" style={{ margin: 0 }}>{t('settings.texts.autoHelp')}</p>
    </Section>
  );
}
