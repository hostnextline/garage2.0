/* « Texto entrant »: the small window keeps the answer being written and the box (comms-guide-10, the window's part of
   comms-guide-09), and the pretend text of « Essayer » gets no answer box (comms-guide-15). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Chat } from '../../shared/customers/texts';

const api = vi.hoisted(() => ({ answers: [] as unknown[], sent: [] as unknown[], replies: [] as unknown[] }));
const reply = () => { const a = api.replies.shift(); if (a instanceof Error) throw a; return a ?? { ok: true, status: 'sent' }; };
vi.mock('../../data/api', () => ({
  conversation: vi.fn(async () => { const a = api.answers.shift(); if (a instanceof Error) throw a; return a; }),
  conversationPhone: vi.fn(async () => { const a = api.answers.shift(); if (a instanceof Error) throw a; return a; }),
  sendChat: vi.fn(async (...x: unknown[]) => { api.sent.push(x); return reply(); }),
  sendChatPhone: vi.fn(async (...x: unknown[]) => { api.sent.push(x); return reply(); })
}));
import { ChatWindow } from './ChatWindow';
import { setDraft, draftOf } from './store';

const box = document.createElement('div');
document.body.appendChild(box);
const ok = { ok: true, status: 'ok', messages: [{ id: 'm1', at: '2026-11-17T14:00:00Z', dir: 'in', body: 'Une place demain ?', kind: 'SMS', status: null }] };
const chat = (phone: string): Chat => ({ phone, name: 'Lara', state: 'open', seenAt: '2026-11-17T14:00:00Z' });
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const draw = (phone: string) => act(() => render(<ChatWindow chat={chat(phone)} texts={[]} who="Lara" customerId={null} onMin={() => undefined} onClose={() => undefined} />, box));
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => { api.answers = []; api.sent = []; api.replies = []; Element.prototype.scrollIntoView = () => undefined; });
afterEach(() => act(() => render(null, box)));

describe('the small window', () => {
  it('the answer being written comes back when the window opens again', async () => {
    setDraft('+15145550177', 'Oui, demain 9 h');
    api.answers.push(ok);
    await draw('+15145550177'); await flush();
    expect((q('text-window-input') as HTMLTextAreaElement).value).toBe('Oui, demain 9 h');
  });
  it('a refresh that fails keeps the box and what is written (a line says the service did not answer)', async () => {
    api.answers.push(ok, new Error('timeout'));
    await draw('+15145550178'); await flush();
    const input = q('text-window-input') as HTMLTextAreaElement;
    await act(() => { input.value = 'Je regarde'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    // the app comes back in view: a refresh, which fails
    await act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(q('text-window-note')).not.toBeNull();
    expect((q('text-window-input') as HTMLTextAreaElement).value).toBe('Je regarde');
    expect(draftOf('5145550178')).toBe('Je regarde');
  });
  it('never read and the service does not answer: the note, no box (as before)', async () => {
    api.answers.push(new Error('timeout'));
    await draw('+15145550179'); await flush();
    expect(q('text-window-note')).not.toBeNull();
    expect(q('text-window-input')).toBeNull();
  });
  it('the pretend text of « Essayer »: no answer box, a line says why', async () => {
    api.answers.push(ok);
    await draw('+15145550100'); await flush();
    expect(q('text-window-input')).toBeNull();
    expect(q('text-window-pretend')).not.toBeNull();
  });
  it('an answer sent: the draft is gone', async () => {
    setDraft('+15145550180', 'Parfait');
    api.answers.push(ok, ok);
    await draw('+15145550180'); await flush();
    await act(() => { (q('text-window-send') as HTMLButtonElement).click(); });
    await flush();
    expect(api.sent).toHaveLength(1);
    expect(draftOf('5145550180')).toBe('');
  });
});

describe('one text, one operation number (R28)', () => {
  const type = async (v: string) => {
    const input = q('text-window-input') as HTMLTextAreaElement;
    await act(() => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  const tap = async () => { await act(() => { (q('text-window-send') as HTMLButtonElement).click(); }); await flush(); };
  it('the answer never came back (no signal): « Envoyer » again carries the same number, so the server sends it once', async () => {
    api.answers.push(ok, ok, ok);
    await draw('+15145550181'); await flush();
    await type('Je suis là dans 10 min');
    api.replies.push(new TypeError('Failed to fetch'));
    await tap();
    expect((q('text-window-input') as HTMLTextAreaElement).value).toBe('Je suis là dans 10 min');
    await tap();
    expect(api.sent).toHaveLength(2);
    const [a, b] = api.sent as unknown[][];
    expect(a[0]).toBe('+15145550181'); expect(a[1]).toBe('Je suis là dans 10 min');
    expect(typeof a[2]).toBe('string'); expect(String(a[2])).toMatch(/^[0-9a-f-]{36}$/);
    expect(b[2]).toBe(a[2]);
    expect(draftOf('5145550181')).toBe('');
  });
  it('the words edited: a new number (another text); the window closed and opened again: the same number', async () => {
    api.answers.push(ok, ok, ok, ok);
    await draw('+15145550182'); await flush();
    await type('Demain 9 h');
    api.replies.push({ ok: false, status: 'error', error: 'timeout' });
    await tap();
    await act(() => render(null, box));
    await draw('+15145550182'); await flush();
    api.replies.push({ ok: false, status: 'error' });
    await tap();
    await type('Demain 10 h');
    await tap();
    const ops = (api.sent as unknown[][]).map((x) => x[2]);
    expect(ops[1]).toBe(ops[0]);
    expect(ops[2]).not.toBe(ops[0]);
  });
  it('sent, then the same words typed again: a new text, a new number', async () => {
    api.answers.push(ok, ok, ok, ok);
    await draw('+15145550183'); await flush();
    await type('Merci');
    await tap();
    await type('Merci');
    await tap();
    const ops = (api.sent as unknown[][]).map((x) => x[2]);
    expect(ops).toHaveLength(2);
    expect(ops[1]).not.toBe(ops[0]);
  });
  it('the first tap still going out (« pending »): the words stay, nothing is lost', async () => {
    api.answers.push(ok, ok);
    await draw('+15145550184'); await flush();
    await type('Bonjour');
    api.replies.push({ ok: false, status: 'pending', again: true, error: 'Ce message est en train de partir.' });
    await tap();
    expect((q('text-window-input') as HTMLTextAreaElement).value).toBe('Bonjour');
    expect(draftOf('5145550184')).toBe('Bonjour');
  });
});
