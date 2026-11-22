/* 🤖 Hermes: the conversation in the panel. Before the first question: the lead, three questions to start with (by what
   this person does) and the privacy lines; then the questions and answers (each answer can be read out loud or copied);
   at the bottom the box, the microphone and « Envoyer » / « Arrêter ». */
import { useEffect, useRef } from 'preact/hooks';
import { Volume2, Copy } from 'lucide-preact';
import { isOwner, hasRole, can } from '../../data/auth';
import { net } from '../../data/sync';
import { t } from '../../lib/i18n';
import { toast, Button, Banner } from '../../ui';
import { garageContext } from './context';
import { chat, hermesBusy, offNote, askHermes } from './session';
import { speak } from './speech';
import { voiceOn } from './prefs';
import { AskBox } from './AskBox';

/** the three first questions offered: by what this person does */
export function suggestionKeys(who: { ownerOrOffice: boolean; treasurer: boolean }): string[] {
  const k = who.ownerOrOffice ? 'suggest' : who.treasurer ? 'tres' : 'meca';
  return [1, 2, 3].map((n) => `hermes.${k}${n}`);
}
const suggestions = () => suggestionKeys({ ownerOrOffice: isOwner() || hasRole('office'), treasurer: hasRole('treasurer') || (can('treasury') && !hasRole('mechanic')) });

export async function send(text: string) {
  const r = await askHermes(text, garageContext);
  if (r.kind === 'answer' && voiceOn()) speak(r.text);
  if (r.kind === 'failed' && r.message) toast(r.message, { kind: 'bad' });
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast(t('hermes.copied'), { kind: 'ok' }); }
  catch { toast(t('hermes.copyFail'), { kind: 'bad' }); }
}

export function HermesChat(p: { owner: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const busy = hermesBusy.value;
  const n = chat.value.length;
  // the newest line in view: when the panel opens, at each question and at each answer
  useEffect(() => {
    const id = setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 40);
    return () => clearTimeout(id);
  }, [n, busy]);
  return (
    <>
      <div class="hermes-body">
        {offNote.value && <Banner kind="warn">{offNote.value}</Banner>}
        {!net.value.online && <Banner kind="warn">{t('hermes.offline')}</Banner>}
        {!n && (
          <>
            <p class="muted small" style={{ margin: 0 }}>{t('hermes.lead')}</p>
            {suggestions().map((k) => (
              <button key={k} type="button" class="hermes-suggest" disabled={busy || !net.value.online} onClick={() => void send(t(k))} data-testid="hermes-suggest">{t(k)}</button>
            ))}
            <p class="faint small" style={{ margin: 0 }}>{t('hermes.privacy')}</p>
            {!p.owner && <p class="faint small" style={{ margin: 0 }} data-testid="hermes-kept">{t('hermes.kept')}</p>}
          </>
        )}
        {chat.value.map((m, i) => (
          <div key={i} class={`hermes-msg hermes-${m.role}`} data-testid={`hermes-${m.role}`}>
            {m.content}
            {m.role === 'assistant' && (
              <div class="hermes-tools">
                <Button size="sm" variant="ghost" icon={<Volume2 size={15} />} onClick={() => speak(m.content)}>{t('hermes.speak')}</Button>
                <Button size="sm" variant="ghost" icon={<Copy size={15} />} onClick={() => copy(m.content)}>{t('hermes.copy')}</Button>
              </div>
            )}
          </div>
        ))}
        {busy && <p class="muted small hermes-thinking" data-testid="hermes-thinking">{t('hermes.thinking')}</p>}
        <div ref={end} />
      </div>
      <AskBox onSend={send} />
    </>
  );
}
