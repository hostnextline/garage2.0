/* « Texto entrant » (owner only): which conversation bubbles show, and how each one stands (open, minimised, closed).
   Pure rules, tested in texts.test.ts; the screen part is TextHost.tsx. */

export interface IncomingText { id: string; phone: string; name: string | null; body: string; at: string }
/** one bubble per number: « open » the small window, « min » the round head, « closed » put away until that number writes again */
export interface Chat { phone: string; name: string | null; state: 'open' | 'min' | 'closed'; seenAt: string }

/** the texts are kept a week on the server: a bubble closed longer ago than this is forgotten */
export const KEEP_MS = 8 * 24 * 3600 * 1000;
/** the first time on a device, only a text this fresh wakes a bubble */
export const FRESH_MS = 3 * 60 * 1000;

/** the same person whatever the way the number is written */
export function phoneId(phone: string | null | undefined): string {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}
/** this number's texts, oldest first */
export function textsOf(texts: IncomingText[], phone: string): IncomingText[] {
  const k = phoneId(phone);
  return texts.filter((x) => phoneId(x.phone) === k).sort((a, b) => a.at.localeCompare(b.at));
}
/** how many of this bubble's texts were not read yet */
export function unread(chat: Chat, texts: IncomingText[]): number {
  return chat.state === 'open' ? 0 : textsOf(texts, chat.phone).filter((x) => x.at > chat.seenAt).length;
}

/** the bubbles after the texts were read again: a new text wakes its bubble (as the small window when `openNew` and no
    other window is open, else as a round head); the same list is given back when nothing changed */
export function nextChats(chats: Chat[], texts: IncomingText[], since: string, openNew: boolean, now = Date.now()): Chat[] {
  const out = chats.filter((c) => c.state !== 'closed' || now - Date.parse(c.seenAt) < KEEP_MS).map((c) => ({ ...c }));
  let hasOpen = out.some((c) => c.state === 'open');
  const newest = new Map<string, IncomingText>();
  for (const x of texts) { const k = phoneId(x.phone), cur = newest.get(k); if (!cur || x.at > cur.at) newest.set(k, x); }
  const order = [...newest.values()].sort((a, b) => a.at.localeCompare(b.at));
  for (const x of order) {
    const c = out.find((y) => phoneId(y.phone) === phoneId(x.phone));
    if (c) {
      if (x.name && !c.name) c.name = x.name;
      if (c.state === 'open') { if (x.at > c.seenAt) c.seenAt = x.at; continue; }
      if (c.state === 'closed' && x.at > c.seenAt) {
        if (openNew && !hasOpen) { c.state = 'open'; c.seenAt = x.at; hasOpen = true; } else c.state = 'min';
      }
      continue;
    }
    if (x.at <= since) continue;
    if (openNew && !hasOpen) { out.push({ phone: x.phone, name: x.name, state: 'open', seenAt: x.at }); hasOpen = true; }
    else out.push({ phone: x.phone, name: x.name, state: 'min', seenAt: since });
  }
  return JSON.stringify(out) === JSON.stringify(chats) ? chats : out;
}

const latest = (texts: IncomingText[], phone: string, fallback: string) => textsOf(texts, phone).pop()?.at || fallback;
/** the small window of this number (one window at a time: the other one becomes a round head) */
export function openChat(chats: Chat[], phone: string, texts: IncomingText[]): Chat[] {
  const k = phoneId(phone);
  return chats.map((c) => phoneId(c.phone) === k ? { ...c, state: 'open' as const, seenAt: latest(texts, c.phone, c.seenAt) }
    : c.state === 'open' ? { ...c, state: 'min' as const } : c);
}
/** back to a round head, everything read */
export function minimiseChat(chats: Chat[], phone: string, texts: IncomingText[]): Chat[] {
  const k = phoneId(phone);
  return chats.map((c) => phoneId(c.phone) === k ? { ...c, state: 'min' as const, seenAt: latest(texts, c.phone, c.seenAt) } : c);
}
/** put away until that number writes again */
export function closeChat(chats: Chat[], phone: string, texts: IncomingText[], now = Date.now()): Chat[] {
  const k = phoneId(phone);
  return chats.map((c) => phoneId(c.phone) === k ? { ...c, state: 'closed' as const, seenAt: latest(texts, c.phone, new Date(now).toISOString()) } : c);
}
/** the round heads to show: the newest text first */
export function heads(chats: Chat[], texts: IncomingText[]): Chat[] {
  return chats.filter((c) => c.state === 'min').sort((a, b) => latest(texts, b.phone, b.seenAt).localeCompare(latest(texts, a.phone, a.seenAt)));
}
