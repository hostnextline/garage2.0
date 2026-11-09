/* Textos: each text sent to customers, on or off, and its words in French and English. While editing: the words
   that are replaced (tap one to insert it), a warning for a word that will not be replaced, and a live preview. */
import { useState } from 'preact/hooks';
import { Pencil, RotateCcw, ChevronUp } from 'lucide-preact';
import { t, lang, type Lang } from '../../lib/i18n';
import { addDays, clock, longDay, today, nowMinute } from '../../lib/dates';
import { money } from '../../lib/money';
import { appBase } from '../../lib/config';
import { settings, garageName, blockOfKey } from '../../data/select';
import { saveSettings } from '../../data/api';
import { Panel, Button, Tabs, Textarea, Banner, Help, attempt } from '../../ui';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';
import { MSG_KINDS, SWITCH_OF, DEFAULT_ON, DEFAULT_TEXTS, VARS_OF, previewParts, unknownVars, insertAt, type MsgKind } from './messages';

interface Texts { on: Record<string, boolean>; fr: Record<string, string>; en: Record<string, string> }

/** example values, in the language of the text */
export function exampleVars(l: Lang): Record<string, string> {
  const b = settings.value.billing;
  const am = blockOfKey('am');
  return {
    prenom: t('settings.texts.example.prenom', undefined, l), garage: garageName.value, jour: longDay(addDays(today(), 1), l),
    bloc: t('settings.texts.example.bloc', undefined, l), payer: t('settings.texts.example.payer', undefined, l),
    debut: clock(am.start, l), fin: clock(am.end, l), total: money(17245, l), lien: `${appBase()}client.html#t=Ab3dE9xQ`,
    mecano: t('settings.texts.example.mecano', undefined, l), heure: clock(Math.min(1435, Math.ceil((nowMinute() + 25) / 5) * 5), l), minutes: '25',
    vehicule: t('settings.texts.example.vehicule', undefined, l), montant: money(8000, l),
    numero: `${b.invoice_prefix ?? 'F-'}${String(43).padStart(Number(b.pad ?? 4), '0')}`, date: longDay(today(), l),
    telephone: settings.value.company?.phone || '438 901-6606',
    services: l === 'en' ? `• Oil change: ${money(7999, l)}\n• Tire swap: ${money(7000, l)}` : `• Changement d’huile\u00a0: ${money(7999, l)}\n• Changement de pneus\u00a0: ${money(7000, l)}`,
    soustotal: `${money(14999, l)} + tx`
  };
}

export function TextsSection() {
  const m = settings.value.messages || { on: {}, fr: {}, en: {} };
  const saved: Texts = {
    on: Object.fromEntries(Object.keys(DEFAULT_ON).map((k) => [k, typeof m.on?.[k] === 'boolean' ? m.on[k] : DEFAULT_ON[k]])),
    fr: Object.fromEntries(MSG_KINDS.map((k) => [k, m.fr?.[k] ?? DEFAULT_TEXTS.fr[k]])),
    en: Object.fromEntries(MSG_KINDS.map((k) => [k, m.en?.[k] ?? DEFAULT_TEXTS.en[k]]))
  };
  const { draft: d, set, dirty, reset } = useSectionDraft<Texts>('texts', saved);
  const [open, setOpen] = useState<MsgKind | null>(null);

  const save = async () => {
    const next = { ...(settings.value.messages || {}), on: { ...(m.on || {}), ...d.on }, fr: { ...(m.fr || {}), ...trimAll(d.fr) }, en: { ...(m.en || {}), ...trimAll(d.en) } };
    if (await attempt(() => saveSettings('messages', next), { ok: t('settings.saved') })) reset();
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
          {MSG_KINDS.map((k) => {
            const sw = SWITCH_OF[k];
            const own = sw === k;
            const on = d.on[sw] !== false;
            const isOpen = open === k;
            return (
              <div key={k} role="listitem" class={`settings-msg${isOpen ? ' is-open' : ''}${on ? '' : ' is-off'}`} data-testid={`msg-${k}`}>
                <div class="settings-msg-head">
                  <span class="grow">
                    <b class="settings-msg-title">{t(`settings.texts.kinds.${k}.title`)}</b>
                    <span class="small muted settings-msg-when">{t(`settings.texts.kinds.${k}.when`)}</span>
                  </span>
                  {own
                    ? <span class="settings-msg-switch">
                        <button type="button" role="switch" class="switch" aria-checked={on} aria-label={`${t('settings.texts.auto')}, ${t(`settings.texts.kinds.${k}.title`)}`}
                          data-testid={`msg-on-${k}`} onClick={() => set((x) => ({ ...x, on: { ...x.on, [sw]: !on } }))} /></span>
                    : <span class="small faint settings-msg-follow">{t('settings.texts.follows', { name: t(`settings.texts.kinds.${sw}.title`) })}</span>}
                </div>
                <div class="settings-msg-row">
                  <p class="settings-msg-sample small">{flat(d[lang.value === 'en' ? 'en' : 'fr'][k])}</p>
                  <Button size="sm" variant={isOpen ? 'secondary' : 'ghost'} icon={isOpen ? <ChevronUp size={16} /> : <Pencil size={16} />} onClick={() => setOpen(isOpen ? null : k)}
                    data-testid={`msg-edit-${k}`}>{isOpen ? t('settings.texts.close') : t('settings.texts.edit')}</Button>
                </div>
                {isOpen && <Editor kind={k} d={d} set={set} />}
              </div>
            );
          })}
        </div>
      </Panel>
      <p class="small faint" style={{ margin: 0 }}>{t('settings.texts.autoHelp')}</p>
    </Section>
  );
}

function Editor(p: { kind: MsgKind; d: Texts; set: (fn: (x: Texts) => Texts) => void }) {
  const [l, setL] = useState<Lang>(lang.value === 'en' ? 'en' : 'fr');
  const id = `msg-text-${p.kind}`;
  const text = p.d[l][p.kind] ?? '';
  const allowed = VARS_OF[p.kind];
  const unknown = unknownVars(text, allowed);
  const vars = exampleVars(l);
  const parts = previewParts(text, Object.fromEntries(allowed.map((v) => [v, vars[v]])));
  const write = (v: string) => p.set((x) => ({ ...x, [l]: { ...x[l], [p.kind]: v } }));
  const insert = (word: string) => {
    const el = document.getElementById(id) as HTMLTextAreaElement | null;
    const r = insertAt(text, el?.selectionStart, el?.selectionEnd, word);
    write(r.text);
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
        <span>{t('settings.texts.chars', { n: flat(text).length })}</span>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={16} />} disabled={text === DEFAULT_TEXTS[l][p.kind]} onClick={() => write(DEFAULT_TEXTS[l][p.kind])}>{t('settings.texts.reset')}</Button>
      </div>
      {!text.trim() && <Banner kind="warn">{t('settings.texts.empty')}</Banner>}
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

const flat = (s: string) => String(s || '').replace(/\s{2,}/g, ' ').trim();
function trimAll(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? '').trim()]));
}
