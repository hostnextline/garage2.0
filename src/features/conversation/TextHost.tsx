/* « Texto entrant » (an owner who switched it on for their own account: `prefs.texts`): when somebody texts the garage's
   number, a conversation bubble shows at the bottom of every screen, like a messenger on the web: a small window (the
   texts both ways, an answer: ChatWindow.tsx), « Réduire » makes it a round head with the count of new texts, « Fermer »
   puts it away until that number writes again. On a computer a new text opens the small window; on a phone it arrives
   as a round head with a few words (never over the work in hand). When more conversations wait than fit, the last head
   is « +N » and opens the next one. Loading: useIncomingTexts.ts; state on the device: store.ts; rules: bubbles.ts. */
import { useEffect, useRef } from 'preact/hooks';
import { MessageCircle } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { formatPhone } from '../../lib/text';
import { customersList, customerName } from '../../data/select';
import { access } from '../../data/auth';
import { Avatar } from '../../ui';
import { phoneOwners } from '../../shared/customers/dupes';
import { hermesOpen, setHermesOpen, textsOn, checkTexts } from '../../services/bubbles';
import { openChat, minimiseChat, closeChat, unread, textsOf, phoneId, type Chat } from '../../shared/customers/texts';
import { ChatWindow } from './ChatWindow';
import { useIncomingTexts } from './useIncomingTexts';
import { chats, setChats } from './store';
import { bubblePlan, openAsked } from './bubbles';
import { repairPushOnce } from './pushRepair';
import { openFromAlert } from './fromAlert';
import '../../shared/customers/conversation.css';

export function TextHost() {
  const on = textsOn();
  const texts = useIncomingTexts(on);
  const who = access.value?.id || null;
  // the alert while the app is closed: the server gets this device's address back if it lost it (comms-guide-08)
  useEffect(() => { if (on && who) repairPushOnce(who); }, [on, who]);
  // a tap on a text's alert while the app is open: that number's conversation opens, a bubble made for it when the text
  // came in while the app was hidden, and the texts are read at once to fill it (comms-guide-14)
  const seen = useRef(texts); seen.current = texts;
  useEffect(() => (on ? openFromAlert((phone) => { setHermesOpen(false); setChats(openAsked(chats.value, phone, seen.current)); checkTexts(); }) : undefined), [on]);
  if (!on) return null;

  const known = (c: Chat) => phoneOwners(c.phone, customersList.value)[0] || null;
  const whoOf = (c: Chat) => { const k = known(c); return k ? customerName(k) : c.name; };
  const { win, round, more, peek } = bubblePlan(chats.value, texts, hermesOpen.value);
  const open = (c: Chat) => { setHermesOpen(false); setChats(openChat(chats.value, c.phone, texts)); };
  const moreLabel = more.length ? t('conversation.bubble.more', { n: more.length }) : '';
  return (
    <>
      {win && <ChatWindow key={phoneId(win.phone)} chat={win} texts={textsOf(texts, win.phone)} who={whoOf(win)} customerId={known(win)?.id || null}
        onMin={() => setChats(minimiseChat(chats.value, win.phone, texts))} onClose={() => setChats(closeChat(chats.value, win.phone, texts))} />}
      {peek && (
        <button type="button" class="conv-peek" onClick={() => open(peek.chat)} data-testid="text-peek">
          <b class="ellipsis">{whoOf(peek.chat) || formatPhone(peek.chat.phone)}</b>
          <span>{peek.text.body || t('conversation.bubble.noWords')}</span>
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
          {more.length > 0 && (
            <button type="button" class="conv-head-btn" onClick={() => open(more[0])} title={moreLabel} aria-label={moreLabel} data-testid="text-head-more">
              <b>+{more.length}</b>
            </button>
          )}
        </div>
      )}
    </>
  );
}
