/* « Texto entrant »: the small window of one number. GoHighLevel's conversation (function « conversation »), plus the
   texts that arrived here and are not in it yet; an answer goes from the garage's number. The answer being written
   stays when the window closes (store.ts). A refresh that fails keeps the box where it is (a line says the service
   did not answer); only a conversation never read, or texts switched off, has no box. The pretend text of « Essayer »
   has none either. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Minus, X, Send, UserRound, CalendarPlus } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { formatPhone } from '../../lib/text';
import { errorMessage } from '../../lib/errors';
import { conversation, conversationPhone, sendChat, sendChatPhone, type ChatMessage } from '../../data/api';
import { wide } from '../../platform/media';
import { IconButton, toast } from '../../ui';
import { callLink } from '../../services/bubbles';
import { lines, type Chat, type IncomingText } from '../../shared/customers/texts';
import { Attachments } from '../../shared/customers/Attachments';
import { draftOf, setDraft } from './store';
import { isPretend, refreshEvery } from './bubbles';

type State = 'ok' | 'off' | 'no_phone' | 'error';

export function ChatWindow(p: { chat: Chat; texts: IncomingText[]; who: string | null; customerId: string | null; onMin: () => void; onClose: () => void }) {
  const l = lang.value;
  const phone = p.chat.phone;
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [state, setState] = useState<State>('ok');
  // the conversation was read once: a later failed refresh does not take the box away
  const [read, setRead] = useState(false);
  const [text, setText] = useState(() => draftOf(phone));
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const asked = useRef(0), activity = useRef(Date.now());
  const newest = p.texts[p.texts.length - 1]?.id || '';
  const pretend = isPretend(phone);

  const load = async () => {
    const mine = ++asked.current;
    let next: State, got: ChatMessage[] | undefined;
    try {
      const r = p.customerId ? await conversation(p.customerId) : await conversationPhone(phone);
      if (!r.ok && r.code) next = 'error';
      else { next = r.status; got = r.messages; }
    } catch { next = 'error'; }
    // an answer older than the last question asked is not drawn over it
    if (mine !== asked.current) return;
    setState(next);
    if (got) setMsgs(got);
    if (next === 'ok') setRead(true);
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null, alive = true;
    activity.current = Date.now();
    const again = () => { timer = setTimeout(() => { if (!document.hidden) void load(); if (alive) again(); }, refreshEvery(activity.current)); };
    const back = () => { if (document.visibilityState === 'visible') void load(); };
    void load();
    again();
    document.addEventListener('visibilitychange', back);
    return () => { alive = false; asked.current++; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', back); };
  }, [phone, p.customerId, newest]);
  // GoHighLevel's conversation, plus the texts that arrived here and are not in it yet (see lines())
  const shown: ChatMessage[] = lines(msgs, p.texts, (x) => ({ id: x.id, at: x.at, dir: 'in' as const, body: x.body || t('conversation.bubble.noWords'), kind: 'SMS', status: null }));
  const last = shown[shown.length - 1];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [shown.length, last?.id, last?.files?.length]);

  const write = (v: string) => { setText(v); setDraft(phone, v); };
  const send = async () => {
    const m = text.trim();
    if (!m || busy) return;
    setBusy(true);
    try {
      const r = p.customerId ? await sendChat(p.customerId, m) : await sendChatPhone(phone, m);
      if (r.status === 'sent') { write(''); activity.current = Date.now(); await load(); }
      else toast(r.error && r.code ? r.error : t(`conversation.status.${r.status === 'off' || r.status === 'no_phone' ? r.status : 'error'}`), { kind: 'bad' });
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); } finally { setBusy(false); }
  };
  const title = p.who || formatPhone(phone);
  const canReply = !pretend && (state === 'ok' || (state === 'error' && read));
  return (
    <section class="conv-win glass-strong" aria-label={t('conversation.bubble.title', { name: title })} data-testid="text-window">
      <header class="conv-win-head">
        <span class="conv-win-who">
          <b class="ellipsis" data-testid="text-window-who">{title}</b>
          <span class="small muted ellipsis">{p.who ? formatPhone(phone) : t('conversation.bubble.noFile')}</span>
        </span>
        {p.customerId
          ? <IconButton icon={<UserRound />} label={t('conversation.bubble.file')} href={`#/customer/${p.customerId}`} onClick={p.onMin} data-testid="text-window-file" />
          : <IconButton icon={<CalendarPlus />} label={t('conversation.bubble.book')} href={`#${callLink({ phone, name: p.chat.name })}`} onClick={p.onMin} data-testid="text-window-book" />}
        <IconButton icon={<Minus />} label={t('conversation.bubble.min')} onClick={p.onMin} data-testid="text-window-min" />
        <IconButton icon={<X />} label={t('conversation.bubble.close')} onClick={p.onClose} data-testid="text-window-close" />
      </header>
      <div class="conv-win-body" role="log" aria-live="polite" data-testid="text-window-list">
        {shown.map((m) => (
          <div key={m.id} class={`conv-msg is-${m.dir}`} data-testid={`text-window-${m.dir}`}>
            <Attachments files={m.files} />
            {m.body.trim() && <p>{m.body}</p>}
            <span class="conv-meta">{m.at ? stamp(m.at, l) : ''}</span>
          </div>
        ))}
        {state !== 'ok' && <p class="small muted conv-win-note" data-testid="text-window-note">{t(`conversation.bubble.${state === 'off' ? 'off' : 'error'}`)}</p>}
        {pretend && <p class="small muted conv-win-note" data-testid="text-window-pretend">{t('conversation.bubble.pretend')}</p>}
        <div ref={end} />
      </div>
      {canReply && (
        <footer class="conv-win-foot">
          <textarea class="textarea conv-win-input" rows={1} maxLength={1000} value={text} placeholder={t('conversation.placeholder')} aria-label={t('conversation.placeholder')}
            onInput={(e) => write((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && wide.value) { e.preventDefault(); void send(); } }} data-testid="text-window-input" />
          <IconButton icon={<Send />} label={t('conversation.send')} onClick={send} disabled={!text.trim() || busy} class="conv-win-send" data-testid="text-window-send" />
        </footer>
      )}
    </section>
  );
}
