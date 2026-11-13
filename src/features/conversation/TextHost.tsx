/* « Texto entrant » (owner only for now): when somebody texts the garage's number, a small conversation bubble shows
   at the bottom of every screen, like a messenger on the web: a small window (the texts both ways, an answer), « Réduire »
   makes it a round head with the count of new texts, « Fermer » puts it away until that number writes again. On a computer
   a new text opens the small window; on a phone it arrives as a round head with a few words (never over the work in hand).
   The texts are noted by the server function « ring » in incoming_texts: told at once (realtime), and asked every 15 s
   while the app is in view. The conversation itself comes from GoHighLevel (function « conversation »). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Minus, X, Send, UserRound, CalendarPlus, MessageCircle } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { formatPhone } from '../../lib/text';
import { sb, isOwner, preview } from '../../data/auth';
import { customersList, customerName } from '../../data/select';
import { conversation, conversationPhone, sendChat, sendChatPhone, errorMessage, type ChatMessage } from '../../data/api';
import { wide } from '../../app/media';
import { REALTIME } from '../../lib/config';
import { Avatar, IconButton, toast } from '../../ui';
import { phoneOwners } from '../customers/dupes';
import { callLink } from '../booking/CallBanner';
import { hermesOpen, setHermesOpen } from '../hermes/host';
import { nextChats, openChat, minimiseChat, closeChat, unread, heads, textsOf, phoneId, FRESH_MS, type Chat, type IncomingText } from './texts';
import './conversation.css';

const LS_CHATS = 'his-text-chats', LS_SINCE = 'his-text-since';
const WEEK_MS = 7 * 24 * 3600 * 1000, ASK_MS = 15 * 1000, REFRESH_MS = 20 * 1000, PEEK_MS = 2 * 60 * 1000, MAX_HEADS = 4;

function stored(): Chat[] {
  try { const v = JSON.parse(localStorage.getItem(LS_CHATS) || '[]'); return Array.isArray(v) ? v.filter((c) => c && typeof c.phone === 'string' && typeof c.seenAt === 'string') : []; }
  catch { return []; }
}
const chats = signal<Chat[]>(stored());
function setChats(next: Chat[]) {
  if (next === chats.value) return;
  chats.value = next;
  try { localStorage.setItem(LS_CHATS, JSON.stringify(next)); } catch { /* private window */ }
}
/** since when this device looks at the texts (the first time: only a text of the last minutes wakes a bubble) */
function since(): string {
  try {
    const v = localStorage.getItem(LS_SINCE);
    if (v) return v;
    const now = new Date(Date.now() - FRESH_MS).toISOString();
    localStorage.setItem(LS_SINCE, now);
    return now;
  } catch { return new Date(Date.now() - FRESH_MS).toISOString(); }
}

let ask: (() => void) | null = null;
/** look now (after « Essayer » in Réglages) */
export const checkTexts = () => ask?.();

export function TextHost() {
  const on = isOwner() && !preview.value;
  const [texts, setTexts] = useState<IncomingText[]>([]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const { data } = await sb.from('incoming_texts').select('id, phone, name, body, at').gte('at', new Date(Date.now() - WEEK_MS).toISOString()).order('at', { ascending: false }).limit(200);
      if (!alive || !data) return;
      const list = data as IncomingText[];
      setTexts(list);
      setChats(nextChats(chats.value, list, since(), wide.value && !hermesOpen.value));
    };
    const look = () => void load().catch(() => undefined);
    ask = look;
    look();
    const timer = setInterval(look, ASK_MS);
    document.addEventListener('visibilitychange', look);
    const ch = REALTIME ? sb.channel('incoming-texts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incoming_texts' }, look).subscribe() : null;
    return () => { alive = false; ask = null; clearInterval(timer); document.removeEventListener('visibilitychange', look); if (ch) void sb.removeChannel(ch); };
  }, [on]);
  if (!on) return null;

  const all = chats.value;
  const known = (c: Chat) => phoneOwners(c.phone, customersList.value)[0] || null;
  const whoOf = (c: Chat) => { const k = known(c); return k ? customerName(k) : c.name; };
  // 🤖 Hermes uses the same corner: while its panel is open, the window waits as a round head
  const win = hermesOpen.value ? null : all.find((c) => c.state === 'open') || null;
  const waiting = all.filter((c) => c.state === 'open' && c !== win);
  const round = [...waiting, ...heads(all, texts)].slice(0, MAX_HEADS);
  const open = (c: Chat) => { setHermesOpen(false); setChats(openChat(chats.value, c.phone, texts)); };
  const fresh = round.find((c) => unread(c, texts) > 0 && Date.now() - Date.parse(textsOf(texts, c.phone).pop()?.at || '') < PEEK_MS) || null;
  const last = fresh ? textsOf(texts, fresh.phone).pop() : null;
  return (
    <>
      {win && <ChatWindow key={phoneId(win.phone)} chat={win} texts={textsOf(texts, win.phone)} who={whoOf(win)} customerId={known(win)?.id || null}
        onMin={() => setChats(minimiseChat(chats.value, win.phone, texts))} onClose={() => setChats(closeChat(chats.value, win.phone, texts))} />}
      {fresh && last && (
        <button type="button" class="conv-peek" onClick={() => open(fresh)} data-testid="text-peek">
          <b class="ellipsis">{whoOf(fresh) || formatPhone(fresh.phone)}</b>
          <span>{last.body || t('conversation.bubble.noWords')}</span>
        </button>
      )}
      {round.length > 0 && (
        <div class="conv-heads" data-testid="text-heads">
          {round.map((c) => {
            const who = whoOf(c), n = unread(c, texts), label = who || formatPhone(c.phone);
            return (
              <button key={phoneId(c.phone)} type="button" class="conv-head-btn" onClick={() => open(c)} title={label}
                aria-label={n ? `${t('conversation.bubble.open', { name: label })}, ${t('conversation.bubble.unread', { n })}` : t('conversation.bubble.open', { name: label })} data-testid="text-head">
                {who ? <Avatar name={who} /> : <MessageCircle size={24} aria-hidden="true" />}
                {n > 0 && <span class="conv-head-count" data-testid="text-head-count">{n > 9 ? '9+' : n}</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function ChatWindow(p: { chat: Chat; texts: IncomingText[]; who: string | null; customerId: string | null; onMin: () => void; onClose: () => void }) {
  const l = lang.value;
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [state, setState] = useState<'ok' | 'off' | 'no_phone' | 'error'>('ok');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const newest = p.texts[p.texts.length - 1]?.id || '';

  const load = async () => {
    try {
      const r = p.customerId ? await conversation(p.customerId) : await conversationPhone(p.chat.phone);
      if (!r.ok && r.code) { setState('error'); return; }
      setState(r.status);
      if (r.messages) setMsgs(r.messages);
    } catch { setState('error'); }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [p.chat.phone, p.customerId, newest]);
  // GoHighLevel's conversation when it answers; meanwhile (or when it is not connected) the texts that arrived here
  const shown: ChatMessage[] = msgs && msgs.length ? msgs
    : p.texts.map((x) => ({ id: x.id, at: x.at, dir: 'in' as const, body: x.body || t('conversation.bubble.noWords'), kind: 'SMS', status: null }));
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [shown.length, shown[shown.length - 1]?.id]);

  const send = async () => {
    const m = text.trim();
    if (!m || busy) return;
    setBusy(true);
    try {
      const r = p.customerId ? await sendChat(p.customerId, m) : await sendChatPhone(p.chat.phone, m);
      if (r.status === 'sent') { setText(''); await load(); }
      else toast(r.error && r.code ? r.error : t(`conversation.status.${r.status === 'off' || r.status === 'no_phone' ? r.status : 'error'}`), { kind: 'bad' });
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); } finally { setBusy(false); }
  };
  const title = p.who || formatPhone(p.chat.phone);
  return (
    <section class="conv-win glass-strong" aria-label={t('conversation.bubble.title', { name: title })} data-testid="text-window">
      <header class="conv-win-head">
        <span class="conv-win-who">
          <b class="ellipsis" data-testid="text-window-who">{title}</b>
          <span class="small muted ellipsis">{p.who ? formatPhone(p.chat.phone) : t('conversation.bubble.noFile')}</span>
        </span>
        {p.customerId
          ? <IconButton icon={<UserRound />} label={t('conversation.bubble.file')} href={`#/customer/${p.customerId}`} onClick={p.onMin} data-testid="text-window-file" />
          : <IconButton icon={<CalendarPlus />} label={t('conversation.bubble.book')} href={`#${callLink({ phone: p.chat.phone, name: p.chat.name })}`} onClick={p.onMin} data-testid="text-window-book" />}
        <IconButton icon={<Minus />} label={t('conversation.bubble.min')} onClick={p.onMin} data-testid="text-window-min" />
        <IconButton icon={<X />} label={t('conversation.bubble.close')} onClick={p.onClose} data-testid="text-window-close" />
      </header>
      <div class="conv-win-body" role="log" aria-live="polite" data-testid="text-window-list">
        {shown.map((m) => (
          <div key={m.id} class={`conv-msg is-${m.dir}`} data-testid={`text-window-${m.dir}`}>
            <p>{m.body}</p>
            <span class="conv-meta">{m.at ? stamp(m.at, l) : ''}</span>
          </div>
        ))}
        {state !== 'ok' && <p class="small muted conv-win-note" data-testid="text-window-note">{t(`conversation.bubble.${state === 'off' ? 'off' : 'error'}`)}</p>}
        <div ref={end} />
      </div>
      {state === 'ok' && (
        <footer class="conv-win-foot">
          <textarea class="textarea conv-win-input" rows={1} maxLength={1000} value={text} placeholder={t('conversation.placeholder')} aria-label={t('conversation.placeholder')}
            onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && wide.value) { e.preventDefault(); void send(); } }} data-testid="text-window-input" />
          <IconButton icon={<Send />} label={t('conversation.send')} onClick={send} disabled={!text.trim() || busy} class="conv-win-send" data-testid="text-window-send" />
        </footer>
      )}
    </section>
  );
}
