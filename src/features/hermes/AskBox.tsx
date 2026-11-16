/* 🤖 Hermes: the box at the bottom of the conversation. The words typed are kept in session.ts (closing the panel does
   not lose them). Enter sends on a computer only: a phone's keyboard has no Shift, so there Enter is a new line and the
   arrow sends. The microphone uses the browser's dictation and stops when the panel closes. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Send, Mic, Square } from 'lucide-preact';
import { net } from '../../data/sync';
import { wide } from '../../platform/media';
import { t } from '../../lib/i18n';
import { toast, IconButton } from '../../ui';
import { draft, hermesBusy, stopHermes } from './session';
import { recognition, heard, type Recognition } from './speech';
import { dictLang, setDictLang, type DictLang } from './prefs';

export function AskBox(p: { onSend: (text: string) => Promise<void> }) {
  const input = useRef<HTMLTextAreaElement>(null), rec = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [dict, setDict] = useState<DictLang>(dictLang);
  const SR = recognition();
  const busy = hermesBusy.value, online = net.value.online, ask = draft.value;
  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 60);
    // the panel closes while listening: the microphone stops with it
    return () => { clearTimeout(id); rec.current?.abort(); rec.current = null; };
  }, []);

  const send = () => { if (online) void p.onSend(draft.value); };
  function dictate() {
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); rec.current = r;
    r.lang = dict; r.interimResults = true; r.continuous = false;
    const before = draft.value;
    r.onresult = (e) => { draft.value = heard(before, e.results); };
    r.onerror = (e) => { if (e.error === 'not-allowed') toast(t('hermes.micDenied'), { kind: 'bad' }); };
    r.onend = () => { setListening(false); if (rec.current === r) rec.current = null; };
    setListening(true);
    try { r.start(); } catch { setListening(false); rec.current = null; }
  }
  const flip = () => { const v: DictLang = dict === 'fr-CA' ? 'en-CA' : 'fr-CA'; setDict(v); setDictLang(v); };
  return (
    <footer class="hermes-foot">
      <div class="hermes-row">
        <textarea ref={input} class="textarea hermes-input" rows={2} value={ask} placeholder={t('hermes.placeholder')} aria-label={t('hermes.ask')} data-testid="hermes-ask"
          onInput={(e) => { draft.value = (e.target as HTMLTextAreaElement).value; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && wide.value) { e.preventDefault(); send(); } }} />
        {SR && <IconButton icon={<Mic size={20} />} label={t('hermes.mic')} pressed={listening} class={listening ? 'hermes-listening' : ''} onClick={dictate} />}
        {busy
          ? <IconButton icon={<Square size={18} />} label={t('hermes.stop')} onClick={stopHermes} data-testid="hermes-stop" />
          : <IconButton icon={<Send size={20} />} label={t('hermes.send')} disabled={!ask.trim() || !online} onClick={send} data-testid="hermes-send" />}
      </div>
      <span class="faint small">
        {SR && <><button type="button" class="hermes-lang" onClick={flip}>🎤 {dict === 'fr-CA' ? t('hermes.dictFr') : t('hermes.dictEn')}</button>{wide.value ? ' · ' : ''}</>}
        {wide.value && t('hermes.keys')}
      </span>
    </footer>
  );
}
