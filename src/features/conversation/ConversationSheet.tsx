/* « Conversation » with a customer: the texts both ways (what the garage sent, what the customer answered), read from
   the garage's GoHighLevel number, and an answer written here, sent from that number. No GoHighLevel app is needed on
   the phone. Opened from the job (next to « Appeler ») and from the customer's file. Refreshes every 20 s while open. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw, Send } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { customer as customerRow, customerName } from '../../data/select';
import { conversation, sendChat, errorMessage, type ChatMessage } from '../../data/api';
import { net } from '../../data/sync';
import { Sheet, Button, IconButton, Textarea, Banner, Skeleton, toast } from '../../ui';
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
  const [state, setState] = useState<'ok' | 'off' | 'no_phone' | 'error' | 'offline'>('ok');
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const r = await conversation(p.customerId);
      if (!r.ok && r.code) { setState('error'); setError(r.error || null); return; }
      setState(r.status); setError(r.error || null);
      setMsgs(r.messages || []);
    } catch (e) { setState(net.value.online ? 'error' : 'offline'); setError(errorMessage(e)); }
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
    try {
      const r = await sendChat(p.customerId, m);
      if (r.status === 'sent') { setText(''); toast(t('conversation.sent'), { kind: 'ok' }); await load(); }
      else toast(r.error && r.code ? r.error : t(`conversation.status.${r.status === 'off' || r.status === 'no_phone' ? r.status : 'error'}`), { kind: 'bad' });
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); } finally { setBusy(false); }
  };
  const smsOff = c?.sms_ok === false;
  return (
    <Sheet open onClose={p.onClose} title={t('conversation.title')} sub={customerName(c)} wide data-testid="conversation-sheet"
      footer={state === 'ok' && !smsOff ? (
        <div class="conv-reply">
          <Textarea value={text} onValue={setText} rows={2} maxLength={1000} placeholder={t('conversation.placeholder')} aria-label={t('conversation.placeholder')} data-testid="conversation-input" />
          <Button variant="primary" icon={<Send />} onClick={send} disabled={!text.trim() || busy} data-testid="conversation-send">{t('conversation.send')}</Button>
        </div>
      ) : <Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="conv-head">
        <span class="small muted">{t('conversation.from')}</span>
        <IconButton icon={<RefreshCw />} label={t('conversation.refresh')} onClick={() => void load()} />
      </div>
      {state !== 'ok' && <Banner kind={state === 'error' ? 'bad' : 'warn'}>{t(`conversation.status.${state}`)}{error && state === 'error' ? ` (${error})` : ''}</Banner>}
      {smsOff && <Banner kind="warn">{t('conversation.smsOff')}</Banner>}
      {state === 'ok' && msgs == null && <Skeleton h={44} lines={4} />}
      {msgs && !msgs.length && state === 'ok' && <p class="muted" style={{ margin: 0 }}>{t('conversation.empty')}</p>}
      {msgs && msgs.length > 0 && (
        <div class="conv-list" role="log" aria-live="polite" data-testid="conversation-list">
          {msgs.map((m) => (
            <div key={m.id} class={`conv-msg is-${m.dir}`} data-testid={`conversation-${m.dir}`}>
              <p>{m.body}</p>
              <span class="conv-meta">{m.dir === 'in' ? t('conversation.them') : t('conversation.us')}{m.at ? `, ${stamp(m.at, l)}` : ''}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
    </Sheet>
  );
}
