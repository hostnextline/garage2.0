/* « Texto entrant »: the small window keeps the answer being written and the box (comms-guide-10, the window's part of
   comms-guide-09), and the pretend text of « Essayer » gets no answer box (comms-guide-15). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Chat } from '../../shared/customers/texts';

const api = vi.hoisted(() => ({ answers: [] as unknown[], sent: [] as unknown[] }));
vi.mock('../../data/api', () => ({
  conversation: vi.fn(async () => { const a = api.answers.shift(); if (a instanceof Error) throw a; return a; }),
  conversationPhone: vi.fn(async () => { const a = api.answers.shift(); if (a instanceof Error) throw a; return a; }),
  sendChat: vi.fn(async (...x: unknown[]) => { api.sent.push(x); return { ok: true, status: 'sent' }; }),
  sendChatPhone: vi.fn(async (...x: unknown[]) => { api.sent.push(x); return { ok: true, status: 'sent' }; })
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

beforeEach(() => { api.answers = []; api.sent = []; Element.prototype.scrollIntoView = () => undefined; });
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
