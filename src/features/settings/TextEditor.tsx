/* The editor of one text: French / English, the words that are replaced (tap one to insert it at the cursor), a warning
   for a word that will not be replaced, « Remettre le texte d'origine », and a live preview with example values. */
import { useState } from 'preact/hooks';
import { RotateCcw } from 'lucide-preact';
import { t, lang, type Lang } from '../../lib/i18n';
import { Button, Tabs, Textarea, Banner, Help } from '../../ui';
import { DEFAULT_TEXTS, VARS_OF, previewParts, unknownVars, insertAt, flatText, type MsgKind } from './messages';
import { textKey, textOf, type TextsView } from './textsModel';
import { exampleVars } from './textsExample';

export function TextEditor(p: { kind: MsgKind; d: TextsView; set: (fn: (x: TextsView) => TextsView) => void }) {
  const [l, setL] = useState<Lang>(lang.value === 'en' ? 'en' : 'fr');
  const id = `msg-text-${p.kind}`;
  const text = textOf(p.d, l, p.kind);
  const allowed = VARS_OF[p.kind];
  const unknown = unknownVars(text, allowed);
  const vars = exampleVars(l);
  const parts = previewParts(text, Object.fromEntries(allowed.map((v) => [v, vars[v]])));
  const write = (v: string) => p.set((x) => ({ ...x, [textKey(l, p.kind)]: v }));
  const insert = (word: string) => {
    const el = document.getElementById(id) as HTMLTextAreaElement | null;
    const r = insertAt(text, el?.selectionStart, el?.selectionEnd, word);
    write(r.text);
    // the cursor goes right after the word put in (once the new text is drawn)
    requestAnimationFrame(() => { const e2 = document.getElementById(id) as HTMLTextAreaElement | null; if (e2) { e2.focus(); e2.setSelectionRange(r.cursor, r.cursor); } });
  };
  return (
    <div class="settings-msg-editor stack" data-testid="msg-editor">
      <Tabs value={l} onValue={setL} label={t(`settings.texts.kinds.${p.kind}.title`)} tabs={[{ value: 'fr', label: t('settings.langFr') }, { value: 'en', label: t('settings.langEn') }]} />
      <label class="field">
        <span class="sr-only">{t(`settings.texts.kinds.${p.kind}.title`)} ({l === 'en' ? t('settings.langEn') : t('settings.langFr')})</span>
        <Textarea id={id} value={text} onValue={write} rows={4} lang={l === 'en' ? 'en-CA' : 'fr-CA'} data-testid="msg-textarea" />
      </label>
      <div class="row between small muted">
        <span>{t('settings.texts.chars', { n: flatText(text).length })}</span>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={16} />} disabled={text === DEFAULT_TEXTS[l][p.kind]} onClick={() => write(DEFAULT_TEXTS[l][p.kind])}>{t('settings.texts.reset')}</Button>
      </div>
      {/* an empty English text: the server sends the French one to an English-speaking customer (notify) */}
      {!text.trim() && <Banner kind="warn">{t(l === 'en' ? 'settings.texts.emptyEn' : 'settings.texts.empty')}</Banner>}
      {unknown.length > 0 && <Banner kind="warn" data-testid="msg-unknown">{t('settings.texts.unknown', { words: unknown.map((w) => `{${w}}`).join(', ') })}</Banner>}
      <div>
        <p class="field-label" style={{ marginBottom: '6px' }}>{t('settings.texts.words')} <Help text={t('settings.texts.wordsHelp')} /></p>
        <div class="settings-words">
          {allowed.map((w) => (
            <button key={w} type="button" class="chip settings-word" onClick={() => insert(w)} data-testid={`word-${w}`}>
              <span>{t(`settings.texts.vars.${w}`)}</span><code>{`{${w}}`}</code>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p class="field-label" style={{ marginBottom: '6px' }}>{t('settings.texts.preview')} <Help text={t('settings.texts.previewHelp')} /></p>
        <div class="settings-sms" lang={l === 'en' ? 'en-CA' : 'fr-CA'} data-testid="msg-preview" aria-live="polite">
          {parts.map((x, i) => (x.unknown ? <mark key={i} class="settings-sms-unknown">{x.text}</mark> : <span key={i}>{x.text}</span>))}
        </div>
      </div>
    </div>
  );
}
