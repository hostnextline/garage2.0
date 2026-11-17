/* The conversation sheet: a refresh that fails keeps the reply box (comms-guide-09), and a slow answer that comes back
   after a newer one is dropped. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const answers: Array<() => Promise<unknown>> = [];
vi.mock('../../data/api', async (orig) => ({
  ...(await orig<typeof import('../../data/api')>()),
  conversation: vi.fn(() => (answers.shift() || (() => Promise.resolve({ status: 'ok', messages: [] })))()),
  sendChat: vi.fn(() => Promise.resolve({ status: 'sent' }))
}));
const { ConversationSheet } = await import('./ConversationSheet');
const api = await import('../../data/api');
const { toasts } = await import('../../ui/toast');

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const type = (v: string) => act(() => {
  const el = q('conversation-input') as HTMLTextAreaElement;
  el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
});
const tap = async () => { await act(() => { q('conversation-send')?.click(); }); await tick(); };
const ops = () => vi.mocked(api.sendChat).mock.calls.map((c) => c[2]);
const msg = (id: string, body: string) => ({ id, at: '2026-11-15T12:00:00.000Z', dir: 'in', body, kind: 'sms', status: null });

describe('the conversation sheet', () => {
  it('a refresh that fails keeps the reply box and the messages, with a line that says so', async () => {
    answers.push(() => Promise.resolve({ status: 'ok', messages: [msg('g1', 'Bonjour')] }));
    await act(() => render(<ConversationSheet customerId="c1" open onClose={() => undefined} />, box));
    await tick();
    expect(q('conversation-input')).not.toBeNull();
    answers.push(() => Promise.reject(new Error('timeout')));
    const refresh = document.body.querySelector('.conv-head .iconbtn') as HTMLElement;
    await act(() => { refresh.click(); });
    await tick();
    expect(q('conversation-input')).not.toBeNull();
    expect(q('conversation-list')?.textContent).toContain('Bonjour');
    expect(document.body.querySelector('.banner')).not.toBeNull();
  });
  it('a slow answer that arrives after a newer one is dropped', async () => {
    let late: (v: unknown) => void = () => undefined;
    answers.push(() => new Promise((r) => { late = r; }));
    await act(() => render(<ConversationSheet customerId="c1" open onClose={() => undefined} />, box));
    answers.push(() => Promise.resolve({ status: 'ok', messages: [msg('g2', 'Nouveau')] }));
    const refresh = document.body.querySelector('.conv-head .iconbtn') as HTMLElement;
    await act(() => { refresh.click(); });
    await tick();
    await act(async () => { late({ status: 'ok', messages: [msg('g1', 'Ancien')] }); });
    await tick();
    expect(q('conversation-list')?.textContent).toContain('Nouveau');
    expect(q('conversation-list')?.textContent).not.toContain('Ancien');
  });
  it('R28: one op per typed text, the same op after a lost answer, a new one once sent or edited', async () => {
    vi.mocked(api.sendChat).mockClear();
    vi.mocked(api.sendChat)
      .mockImplementationOnce(() => Promise.reject(new Error('timeout')))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 'sent', again: true }))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 'error' }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 'sent' }));
    await act(() => render(<ConversationSheet customerId="c1" open onClose={() => undefined} />, box));
    await tick();
    await type('Je suis en route');
    await tap();                       // the answer is lost: the text stays
    expect((q('conversation-input') as HTMLTextAreaElement).value).toBe('Je suis en route');
    await tap();                       // second tap: same op, the server says it already went
    expect((q('conversation-input') as HTMLTextAreaElement).value).toBe('');
    await type('Bonjour');
    await tap();                       // refused: the text stays with its op
    await type('Bonjour, ');           // edited: a new op
    await tap();
    const [a, b, c, d] = ops();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(c);
    expect(vi.mocked(api.sendChat).mock.calls.map((x) => x[1])).toEqual(['Je suis en route', 'Je suis en route', 'Bonjour', 'Bonjour,']);
  });
  it('R28: « pending » keeps the text and its op, and says the server’s words', async () => {
    vi.mocked(api.sendChat).mockClear();
    vi.mocked(api.sendChat)
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 'pending', again: true, error: 'Ce message est en train de partir.' }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, status: 'sent', again: true }));
    await act(() => render(<ConversationSheet customerId="c1" open onClose={() => undefined} />, box));
    await tick();
    await type('Allo');
    await tap();
    expect((q('conversation-input') as HTMLTextAreaElement).value).toBe('Allo');
    expect(toasts.value.map((x) => x.text)).toContain('Ce message est en train de partir.');
    await tap();
    const [a, b] = ops();
    expect(b).toBe(a);
    expect((q('conversation-input') as HTMLTextAreaElement).value).toBe('');
  });
});
