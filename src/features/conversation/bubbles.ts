/* « Texto entrant »: what the host draws from the bubbles' state (the state machine itself is shared/customers/texts.ts),
   and how often it asks the server. Pure: tested in bubbles.test.ts. */
import { heads, unread, textsOf, phoneId, type Chat, type IncomingText } from '../../shared/customers/texts';

export const MAX_HEADS = 4;
/** a text this young with words not read yet shows as a « peek » (name + two lines) */
export const PEEK_MS = 2 * 60 * 1000;
/** the pretend text of « Essayer » (Réglages → Branchements) comes from this number (server function « ring »):
    nobody's phone, so its window offers no answer (an answer would make a GoHighLevel contact and send a real SMS) */
export const PRETEND_PHONE = '5145550100';
export function isPretend(phone: string): boolean { return phoneId(phone) === PRETEND_PHONE; }

export interface BubblePlan {
  /** the small window (none while the Hermes panel holds the corner) */
  win: Chat | null;
  /** the round heads drawn, the newest text first */
  round: Chat[];
  /** conversations with a head that did not fit: drawn as one « +N » head */
  more: Chat[];
  /** the head whose newest text is young and unread: its words show beside it */
  peek: { chat: Chat; text: IncomingText } | null;
}

export function bubblePlan(chats: Chat[], texts: IncomingText[], hermesOpen: boolean, now = Date.now()): BubblePlan {
  // 🤖 Hermes uses the same corner: while its panel is open, the window waits as a round head
  const win = hermesOpen ? null : chats.find((c) => c.state === 'open') || null;
  const all = [...chats.filter((c) => c.state === 'open' && c !== win), ...heads(chats, texts)];
  // nothing may be lost from sight: when they do not all fit, the last place is « +N »
  const fit = all.length > MAX_HEADS ? MAX_HEADS - 1 : MAX_HEADS;
  const round = all.slice(0, fit), more = all.slice(fit);
  let peek: BubblePlan['peek'] = null;
  for (const c of round) {
    const last = textsOf(texts, c.phone).pop();
    if (last && unread(c, texts) > 0 && now - Date.parse(last.at) < PEEK_MS) { peek = { chat: c, text: last }; break; }
  }
  return { win, round, more, peek };
}

/* ---------- asking the server ---------- */
/** realtime tells each new text at once: the list is then only checked now and then; without it, every 15 s */
export const ASK_MS = 15 * 1000, ASK_LIVE_MS = 60 * 1000;
export function askEvery(live: boolean): number { return live ? ASK_LIVE_MS : ASK_MS; }
/** the same texts as before (then nothing is drawn again) */
export function sameTexts(a: IncomingText[], b: IncomingText[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.body === b[i].body && x.name === b[i].name);
}

/** an open window asks GoHighLevel again (three requests each time): every 20 s while the conversation moves (just opened,
    a new text, an answer sent), every minute once it has been quiet for two minutes */
export const REFRESH_MS = 20 * 1000, REFRESH_QUIET_MS = 60 * 1000, QUIET_AFTER_MS = 2 * 60 * 1000;
export function refreshEvery(lastActivity: number, now = Date.now()): number {
  return now - lastActivity < QUIET_AFTER_MS ? REFRESH_MS : REFRESH_QUIET_MS;
}
