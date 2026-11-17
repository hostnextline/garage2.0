/* « Conversation » with a customer: the texts both ways (what the garage sent, what the customer answered), read from
   the garage's GoHighLevel number, and an answer written here, sent from that number. No GoHighLevel app is needed on
   the phone. Opened from the job (next to « Appeler ») and from the customer's file. Refreshes every 20 s while open and
   shown; a refresh that fails never takes the reply box away (the send says itself whether it went). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw, Send } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { customer as customerRow, customerName } from '../../data/select';
import { conversation, sendChat, errorMessage, type ChatMessage } from '../../data/api';
import { net } from '../../data/sync';
import { uuid } from '../../data/sender';
import { Sheet, Button, IconButton, Textarea, Banner, Skeleton, toast } from '../../ui';
import { Attachments } from './Attachments';
import './conversation.css';

const REFRESH_MS = 20000;

export function ConversationSheet(p: { customerId: string | null | undefined; open: boolean; onClose: () => void }) {
  if (!p.open || !p.customerId) return null;
  return <Open customerId={p.customerId} onClose={p.onClose} />;
}

function Open(p: { customerId: string; onClose: () => void }) {
  const l = lang.value;
  const c = customerRow(p.customerId);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  // what the server said (GoHighLevel connected or not, a phone or not), and apart from it a read that failed: a refresh
  // that fails (one bar of signal in a driveway) shows a line above the list and keeps the reply box with what is typed
  const [state, setState] = useState<'ok' | 'off' | 'no_phone'>('ok');
  const [trouble, setTrouble] = useState<null | 'error' | 'offline'>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // one operation id per typed text (R28), kept until it is sent or edited: a second tap after a lost answer (one bar of
  // signal) carries the same id and the server sends the text once (a text for another customer never reuses it)
  const op = useRef<{ text: string; to: string; id: string } | null>(null);
  const edit = (v: string) => { setText(v); if (op.current && op.current.text !== v.trim()) op.current = null; };
  const end = useRef<HTMLDivElement>(null);
  // only the answer of the latest read is used (a slow one that comes back after a newer one is dropped), never after closing
  const asked = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = async () => {
    const n = ++asked.current;
    try {
      const r = await conversation(p.customerId);
      if (!alive.current || n !== asked.current) return;
      if ((!r.ok && r.code) || r.status === 'error') { setTrouble('error'); setError(r.error || null); return; }
      setState(r.status); setTrouble(null); setError(r.error || null);
      setMsgs(r.messages || []);
    } catch (e) {
      if (!alive.current || n !== asked.current) return;
      setTrouble(net.value.online ? 'error' : 'offline'); setError(errorMessage(e));
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [p.customerId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  const send = async () => {
    const m = text.trim();
    if (!m || busy) return;
    setBusy(true);
    if (!op.current || op.current.text !== m || op.current.to !== p.customerId) op.current = { text: m, to: p.customerId, id: uuid() };
    try {
      const r = await sendChat(p.customerId, m, op.current.id);
      if (r.status === 'sent') { op.current = null; setText(''); toast(t('conversation.sent'), { kind: 'ok' }); await load(); }
      // « pending »: the same op is still leaving (the server's words); the text and its op stay for a later tap
      else toast(r.error && (r.code || r.status === 'pending') ? r.error : t(`conversation.status.${r.status === 'off' || r.status === 'no_phone' ? r.status : 'error'}`), { kind: 'bad' });
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); } finally { if (alive.current) setBusy(false); }
  };
  const smsOff = c?.sms_ok === false;
  return (
    <Sheet open onClose={p.onClose} title={t('conversation.title')} sub={customerName(c)} wide data-testid="conversation-sheet"
      footer={state === 'ok' && !smsOff ? (
        <div class="conv-reply">
          <Textarea value={text} onValue={edit} rows={2} maxLength={1000} placeholder={t('conversation.placeholder')} aria-label={t('conversation.placeholder')} data-testid="conversation-input" />
          <Button variant="primary" icon={<Send />} onClick={() => send()} disabled={!text.trim() || busy} data-testid="conversation-send">{t('conversation.send')}</Button>
        </div>
      ) : <Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="conv-head">
        <span class="small muted">{t('conversation.from')}</span>
        <IconButton icon={<RefreshCw />} label={t('conversation.refresh')} onClick={() => load()} />
      </div>
      {trouble ? <Banner kind={trouble === 'error' ? 'bad' : 'warn'}>{t(`conversation.status.${trouble}`)}{error && trouble === 'error' ? ` (${error})` : ''}</Banner>
        : state !== 'ok' && <Banner kind="warn">{t(`conversation.status.${state}`)}</Banner>}
      {smsOff && <Banner kind="warn">{t('conversation.smsOff')}</Banner>}
      {state === 'ok' && !trouble && msgs == null && <Skeleton h={44} lines={4} />}
      {msgs && !msgs.length && state === 'ok' && <p class="muted" style={{ margin: 0 }}>{t('conversation.empty')}</p>}
      {msgs && msgs.length > 0 && (
        <div class="conv-list" role="log" aria-live="polite" data-testid="conversation-list">
          {msgs.map((m) => (
            <div key={m.id} class={`conv-msg is-${m.dir}`} data-testid={`conversation-${m.dir}`}>
              <Attachments files={m.files} />
              {m.body.trim() && <p>{m.body}</p>}
              <span class="conv-meta">{m.dir === 'in' ? t('conversation.them') : t('conversation.us')}{m.at ? `, ${stamp(m.at, l)}` : ''}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </Sheet>
  );
}
