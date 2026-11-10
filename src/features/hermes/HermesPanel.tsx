/* 🤖 Hermes: the conversation. Each question goes with the garage's picture (context.ts) to the server function « hermes »,
   which asks Hermes with the key kept on the server. Mic (the browser's dictation) and reading out loud, like the CRM's. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Send, Mic, Volume2, RotateCcw, Copy, Square, Users, MessageCircle } from 'lucide-preact';
import { callFn, isOwner, hasRole, can } from '../../data/auth';
import { net } from '../../data/sync';
import { t } from '../../lib/i18n';
import { toast, IconButton, Button, Banner } from '../../ui';
import { garageContext } from './context';
import { hermesBusy } from './host';
import { TeamLog } from './TeamLog';

type Msg = { role: 'user' | 'assistant'; content: string };
const newSession = () => Math.random().toString(36).slice(2, 12);
const store = { get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
/* kept while the app is open, the panel closed or not */
const chat = signal<Msg[]>([]);
const session = signal(newSession());
let ctl: AbortController | null = null;

const SR: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
const isFrench = (s: string) => { const w = (s.toLowerCase().match(/\b(le|la|les|des|est|pour|vous|tu|une|avec|que|qui|pas|dans|sur|votre|ton)\b/g) || []).length; return w >= Math.max(3, s.split(/\s+/).length * 0.08); };
export function speak(text: string) {
  try {
    const ss = window.speechSynthesis; if (!ss) return;
    ss.cancel();
    const l = isFrench(text) ? 'fr-CA' : 'en-CA';
    const v = ss.getVoices().find((x) => x.lang === l) || ss.getVoices().find((x) => x.lang?.startsWith(l.slice(0, 2)));
    for (const part of text.replace(/[*#_`>|]/g, '').match(/[^.!?\n]+[.!?]?/g) || []) {
      const u = new SpeechSynthesisUtterance(part.trim()); u.lang = l; if (v) u.voice = v; ss.speak(u);
    }
  } catch { /* no voice on this browser */ }
}

/** the three first questions offered: by what this person does */
function suggestions(): string[] {
  const k = isOwner() || hasRole('office') ? 'suggest' : hasRole('treasurer') || (can('treasury') && !hasRole('mechanic')) ? 'tres' : 'meca';
  return [1, 2, 3].map((n) => `hermes.${k}${n}`);
}

export function HermesPanel() {
  const [ask, setAsk] = useState('');
  const [listening, setListening] = useState(false);
  const [dict, setDict] = useState(() => store.get('his-hermes-lang', 'fr-CA'));
  const [voice, setVoice] = useState(() => store.get('his-hermes-voice', '0') === '1');
  const [off, setOff] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), rec = useRef<any>(null);
  const busy = hermesBusy.value;
  const [view, setView] = useState<'chat' | 'team'>('chat');
  const owner = isOwner();
  const scroll = () => setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 40);
  useEffect(() => { scroll(); setTimeout(() => input.current?.focus(), 60); }, []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || hermesBusy.value) return;
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    const msgs: Msg[] = [...chat.value, { role: 'user', content: q }];
    chat.value = msgs; setAsk(''); hermesBusy.value = true; scroll();
    const mine = (ctl = new AbortController());
    let context = '';
    try { context = garageContext(); } catch { context = 'The garage data is not available right now.'; }
    try {
      const r = await Promise.race([
        callFn<{ text?: string }>('hermes', { messages: msgs, context, session: session.value }, 150000),
        new Promise<never>((_, rej) => mine.signal.addEventListener('abort', () => rej(Object.assign(new Error('stop'), { name: 'AbortError' }))))
      ]);
      if (ctl !== mine) return;
      if (!r.ok || !r.text) {
        chat.value = chat.value.slice(0, -1); setAsk(q);
        if (r.code === 'hermes_off') setOff(r.error || null); else toast(r.error || t('errors.server'), { kind: 'bad' });
      } else {
        chat.value = [...chat.value, { role: 'assistant', content: r.text }]; setOff(null);
        if (store.get('his-hermes-voice', '0') === '1') speak(r.text);
      }
    } catch (e) {
      if (ctl === mine) { chat.value = chat.value.slice(0, -1); setAsk(q); if ((e as Error)?.name !== 'AbortError') toast(t('errors.server'), { kind: 'bad' }); }
    } finally {
      if (ctl === mine) { ctl = null; hermesBusy.value = false; scroll(); }
    }
  }
  function stop() { ctl?.abort(); ctl = null; hermesBusy.value = false; }
  function restart() { stop(); try { window.speechSynthesis?.cancel(); } catch { /* */ } chat.value = []; session.value = newSession(); setOff(null); }
  function dictate() {
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); rec.current = r;
    r.lang = dict; r.interimResults = true; r.continuous = false;
    const before = ask ? ask.trimEnd() + ' ' : '';
    r.onresult = (e: any) => { let s = ''; for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript; setAsk(before + s); };
    r.onerror = (e: any) => { if (e.error === 'not-allowed') toast(t('hermes.micDenied'), { kind: 'bad' }); };
    r.onend = () => setListening(false);
    setListening(true); r.start();
  }

  return (
    <section class="hermes-panel glass-strong" aria-label={t('hermes.title')} data-testid="hermes-panel">
      <header class="hermes-head">
        <b class="grow">🤖 {view === 'team' ? t('hermes.team') : t('hermes.title')}</b>
        {owner && (view === 'chat'
          ? <IconButton icon={<Users size={18} />} label={t('hermes.team')} onClick={() => setView('team')} data-testid="hermes-team-open" />
          : <IconButton icon={<MessageCircle size={18} />} label={t('hermes.back')} onClick={() => setView('chat')} data-testid="hermes-team-back" />)}
        <IconButton icon={<Volume2 size={18} />} label={t('hermes.voice')} pressed={voice}
          onClick={() => { const v = !voice; setVoice(v); store.set('his-hermes-voice', v ? '1' : '0'); if (!v) window.speechSynthesis?.cancel(); }} />
        {chat.value.length > 0 && <IconButton icon={<RotateCcw size={18} />} label={t('hermes.newChat')} onClick={restart} data-testid="hermes-new" />}
      </header>
      {view === 'team' ? <div class="hermes-body"><TeamLog /></div> : <>
      <div class="hermes-body">
        {off && <Banner kind="warn">{off}</Banner>}
        {!net.value.online && <Banner kind="warn">{t('hermes.offline')}</Banner>}
        {!chat.value.length && (
          <>
            <p class="muted small" style={{ margin: 0 }}>{t('hermes.lead')}</p>
            {suggestions().map((k) => (
              <button key={k} type="button" class="hermes-suggest" disabled={busy} onClick={() => void send(t(k))} data-testid="hermes-suggest">{t(k)}</button>
            ))}
            <p class="faint small" style={{ margin: 0 }}>{t('hermes.privacy')}</p>
            {!owner && <p class="faint small" style={{ margin: 0 }} data-testid="hermes-kept">{t('hermes.kept')}</p>}
          </>
        )}
        {chat.value.map((m, i) => (
          <div key={i} class={`hermes-msg hermes-${m.role}`} data-testid={`hermes-${m.role}`}>
            {m.content}
            {m.role === 'assistant' && (
              <div class="hermes-tools">
                <Button size="sm" variant="ghost" icon={<Volume2 size={15} />} onClick={() => speak(m.content)}>{t('hermes.speak')}</Button>
                <Button size="sm" variant="ghost" icon={<Copy size={15} />} onClick={async () => { try { await navigator.clipboard.writeText(m.content); toast(t('hermes.copied'), { kind: 'ok' }); } catch { toast(t('hermes.copyFail'), { kind: 'bad' }); } }}>{t('hermes.copy')}</Button>
              </div>
            )}
          </div>
        ))}
        {busy && <p class="muted small hermes-thinking" data-testid="hermes-thinking">{t('hermes.thinking')}</p>}
        <div ref={end} />
      </div>
      <footer class="hermes-foot">
        <div class="hermes-row">
          <textarea ref={input} class="textarea hermes-input" rows={2} value={ask} placeholder={t('hermes.placeholder')} aria-label={t('hermes.ask')} data-testid="hermes-ask"
            onInput={(e) => setAsk((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !(e as any).isComposing) { e.preventDefault(); void send(ask); } }} />
          {SR && <IconButton icon={<Mic size={20} />} label={t('hermes.mic')} pressed={listening} class={listening ? 'hermes-listening' : ''} onClick={dictate} />}
          {busy
            ? <IconButton icon={<Square size={18} />} label={t('hermes.stop')} onClick={stop} data-testid="hermes-stop" />
            : <IconButton icon={<Send size={20} />} label={t('hermes.send')} disabled={!ask.trim()} onClick={() => void send(ask)} data-testid="hermes-send" />}
        </div>
        <span class="faint small">
          {SR && <><button type="button" class="hermes-lang" onClick={() => { const v = dict === 'fr-CA' ? 'en-CA' : 'fr-CA'; setDict(v); store.set('his-hermes-lang', v); }}>
            🎤 {dict === 'fr-CA' ? t('hermes.dictFr') : t('hermes.dictEn')}</button> · </>}
          {t('hermes.keys')}
        </span>
      </footer>
      </>}
    </section>
  );
}
