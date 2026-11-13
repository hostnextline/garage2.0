import { describe, it, expect } from 'vitest';
import { nextChats, openChat, minimiseChat, closeChat, unread, heads, phoneId, lines, KEEP_MS, type Chat, type IncomingText, type Line } from './texts';

const t0 = Date.parse('2026-11-12T15:00:00Z');
const iso = (min: number) => new Date(t0 + min * 60000).toISOString();
const text = (id: string, phone: string, min: number, name: string | null = null, body = 'Bonjour'): IncomingText => ({ id, phone, name, body, at: iso(min) });
const A = '+15145550100', B = '+14385550162';

describe('« Texto entrant » bubbles', () => {
  it('the same person whatever the way the number is written', () => {
    expect(phoneId('+1 (514) 555-0100')).toBe('5145550100');
    expect(phoneId('514 555-0100')).toBe(phoneId(A));
  });

  it('a new text wakes a bubble; a text from before this device started looking does not', () => {
    const texts = [text('old', B, -10), text('new', A, 1, 'Nadia Roy')];
    const phone = nextChats([], texts, iso(0), false, t0);
    expect(phone).toEqual([{ phone: A, name: 'Nadia Roy', state: 'min', seenAt: iso(0) }]);
    expect(unread(phone[0], texts)).toBe(1);
    // on a computer the small window opens by itself, already read
    const desk = nextChats([], texts, iso(0), true, t0);
    expect(desk[0].state).toBe('open');
    expect(unread(desk[0], texts)).toBe(0);
  });

  it('one window at a time: a second person arrives as a round head', () => {
    const texts = [text('a', A, 1), text('b', B, 2)];
    const chats = nextChats([], texts, iso(0), true, t0);
    expect(chats.map((c) => [c.phone, c.state])).toEqual([[A, 'open'], [B, 'min']]);
    const swapped = openChat(chats, B, texts);
    expect(swapped.map((c) => [c.phone, c.state])).toEqual([[A, 'min'], [B, 'open']]);
    expect(unread(swapped[1], texts)).toBe(0);
  });

  it('minimised: the new texts are counted on the head; opening reads them', () => {
    let texts = [text('a', A, 1)];
    let chats = minimiseChat(nextChats([], texts, iso(0), true, t0), A, texts);
    expect(chats[0].state).toBe('min');
    expect(unread(chats[0], texts)).toBe(0);
    texts = [...texts, text('a2', A, 5), text('a3', A, 6)];
    chats = nextChats(chats, texts, iso(0), true, t0);
    expect(chats[0].state).toBe('min');
    expect(unread(chats[0], texts)).toBe(2);
    expect(unread(openChat(chats, A, texts)[0], texts)).toBe(0);
  });

  it('closed: gone until that number writes again', () => {
    let texts = [text('a', A, 1)];
    let chats = closeChat(nextChats([], texts, iso(0), false, t0), A, texts, t0);
    expect(heads(chats, texts)).toEqual([]);
    expect(nextChats(chats, texts, iso(0), false, t0)).toBe(chats);
    texts = [...texts, text('a2', A, 9)];
    chats = nextChats(chats, texts, iso(0), false, t0);
    expect(heads(chats, texts).map((c) => c.phone)).toEqual([A]);
    expect(unread(chats[0], texts)).toBe(1);
  });

  it('nothing new: the same list (no needless redraw); an old closed bubble is forgotten', () => {
    const texts = [text('a', A, 1)];
    const chats = nextChats([], texts, iso(0), false, t0);
    expect(nextChats(chats, texts, iso(0), false, t0)).toBe(chats);
    const closed: Chat[] = [{ phone: B, name: null, state: 'closed', seenAt: iso(0) }];
    expect(nextChats(closed, [], iso(0), false, t0 + KEEP_MS + 1000)).toEqual([]);
  });

  it('the heads: the newest text first', () => {
    const texts = [text('a', A, 1), text('b', B, 2)];
    const chats = nextChats([], texts, iso(0), false, t0);
    expect(heads(chats, texts).map((c) => c.phone)).toEqual([B, A]);
  });

  it('the window: GoHighLevel’s conversation, plus the texts it does not have yet', () => {
    const make = (x: IncomingText): Line => ({ id: x.id, at: x.at, dir: 'in', body: x.body });
    const texts = [text('a', A, 1, null, 'Bonjour'), text('b', A, 5, null, 'Demain matin ?')];
    // GoHighLevel does not answer: everything that arrived here
    expect(lines(null, texts, make).map((m) => m.body)).toEqual(['Bonjour', 'Demain matin ?']);
    // it has the first text and our answer: only the newest one is added, never twice
    const conv = [{ id: 'g1', at: iso(1), dir: 'in' as const, body: 'Bonjour' }, { id: 'g2', at: iso(3), dir: 'out' as const, body: 'Oui ?' }];
    expect(lines(conv, texts, make).map((m) => m.body)).toEqual(['Bonjour', 'Oui ?', 'Demain matin ?']);
    // an answer sent after a text GoHighLevel does not have: the text stays, in its place
    expect(lines([{ id: 'g9', at: iso(7), dir: 'out' as const, body: 'On arrive' }], [text('z', A, 8, null, 'Merci')], make).map((m) => m.body)).toEqual(['On arrive', 'Merci']);
    expect(lines([{ id: 'g9', at: iso(3), dir: 'out' as const, body: 'Oui ?' }], texts, make).map((m) => m.body)).toEqual(['Bonjour', 'Oui ?', 'Demain matin ?']);
    const full = [...conv, { id: 'g3', at: iso(5), dir: 'in' as const, body: 'Demain matin ?' }];
    expect(lines(full, texts, make).map((m) => m.id)).toEqual(['g1', 'g2', 'g3']);
  });
});

import { pushAbility } from './push';
describe('the alert while the app is closed: what a device can do', () => {
  const base = { sw: true, push: true, notif: true, permission: 'default', ios: false, standalone: false };
  it('ready, blocked, an iPhone that must install the app first, or a browser that cannot', () => {
    expect(pushAbility(base)).toBe('ok');
    expect(pushAbility({ ...base, permission: 'denied' })).toBe('denied');
    expect(pushAbility({ ...base, push: false, notif: false, ios: true })).toBe('install');
    expect(pushAbility({ ...base, ios: true, standalone: true })).toBe('ok');
    expect(pushAbility({ ...base, push: false })).toBe('unsupported');
  });
});
