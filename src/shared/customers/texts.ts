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

export interface Line { id: string; at: string | null; dir: 'in' | 'out'; body: string; files?: string[] }
/** a text that arrived here and GoHighLevel's message are the same one when this close in time (and with the same words,
    or, for a text with no words, a message with a picture) */
const SAME_MS = 10 * 60 * 1000;
/** what the window shows: GoHighLevel's conversation, plus the texts that arrived here and are not in it yet (the newest
    one, told to us before GoHighLevel's list has it; or everything while GoHighLevel does not answer). A short answer
    said again later (« Merci », « Ok ») is a new text: the words alone do not make two texts the same one. */
export function lines<T extends Line>(conv: T[] | null, texts: IncomingText[], make: (x: IncomingText) => T): T[] {
  const list = conv || [];
  // a long conversation: GoHighLevel gives its last messages only, so nothing older than those is added
  const firstAt = list.length < 50 ? '' : list.reduce((m, x) => (x.at && (!m || x.at < m) ? x.at : m), '');
  const inbound = list.filter((m) => m.dir === 'in');
  const near = (m: Line, at: number) => !!m.at && Math.abs(Date.parse(m.at) - at) < SAME_MS;
  const there = (x: IncomingText) => {
    const words = x.body.trim(), at = Date.parse(x.at);
    return inbound.some((m) => (words ? m.body.trim() === words && (!m.at || near(m, at)) : !m.body.trim() && !!m.files?.length && near(m, at)));
  };
  const extra = texts.filter((x) => x.at >= firstAt && !there(x)).map(make);
  return extra.length ? [...list, ...extra].sort((a, b) => String(a.at).localeCompare(String(b.at))) : list;
}

/* ---------- pictures and documents ---------- */
type FileKind = 'image' | 'video' | 'audio' | 'file' | 'unknown';
const KINDS: Record<Exclude<FileKind, 'unknown'>, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'],
  video: ['mp4', 'm4v', 'mov', 'webm', '3gp', '3gpp'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'amr', 'opus'],
  file: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'ppt', 'pptx', 'zip', 'vcf', 'heic', 'heif', 'tif', 'tiff', 'pages', 'numbers']
};
/** the name at the end of a web address (« facture.pdf »): empty when there is none */
export function fileName(url: string): string {
  let path = String(url || '').split(/[?#]/)[0];
  try { path = new URL(url).pathname; } catch { /* not a full address */ }
  const last = path.split('/').filter(Boolean).pop() || '';
  try { return decodeURIComponent(last).slice(0, 80); } catch { return last.slice(0, 80); }
}
/** how an attachment is shown, from the end of its name; « unknown » (no ending): tried as a picture, else a link */
export function fileKind(url: string): FileKind {
  const ext = /\.([a-z0-9]{2,7})$/i.exec(fileName(url))?.[1]?.toLowerCase();
  if (!ext) return 'unknown';
  return (Object.keys(KINDS) as (keyof typeof KINDS)[]).find((k) => KINDS[k].includes(ext)) || 'file';
}
/** only a secure web address is ever opened or shown (never a script, a data address or plain http) */
export const safeFiles = (files: string[] | null | undefined): string[] => (Array.isArray(files) ? files : []).filter((u) => typeof u === 'string' && /^https:\/\/[^\s/]/i.test(u));
