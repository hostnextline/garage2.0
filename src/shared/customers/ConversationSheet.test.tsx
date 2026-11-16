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

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
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
});
