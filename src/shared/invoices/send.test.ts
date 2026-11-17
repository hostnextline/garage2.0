/* Texting an invoice: one id per send, kept until the server answers (R27). A tap again after an answer lost on a weak
   signal is the same send (the server texts it once); after an answer, a new tap is a new send. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));

import { sendText } from './send';

const offline = () => Object.assign(new TypeError('Failed to fetch'), { status: 0 });
const opOf = (n: number) => (api.notify.mock.calls[n][2] as { op: string }).op;

beforeEach(() => { api.notify.mockReset(); });

describe('one send, one text', () => {
  it('the answer is lost: the second tap carries the same id; once answered, the next tap is a new send', async () => {
    api.notify.mockRejectedValueOnce(offline()).mockResolvedValueOnce({ status: 'sent' }).mockResolvedValueOnce({ status: 'sent' });
    await sendText('invoice', 'j-1');
    await sendText('invoice', 'j-1');
    await sendText('invoice', 'j-1');
    expect(opOf(0)).toMatch(/^[0-9a-f-]{36}$/);
    expect(opOf(1)).toBe(opOf(0));
    expect(opOf(2)).not.toBe(opOf(0));
  });
  it('two taps at once are one send; another job or a reminder is another send', async () => {
    let answer: (v: unknown) => void = () => undefined;
    api.notify.mockImplementationOnce(() => new Promise((r) => { answer = r; })).mockResolvedValue({ status: 'sent' });
    const first = sendText('invoice', 'j-2');
    await sendText('invoice', 'j-2');
    await sendText('invoice', 'j-3');
    await sendText('payment_reminder', 'j-2');
    answer({ status: 'sent' });
    await first;
    expect(opOf(1)).toBe(opOf(0));
    expect(opOf(2)).not.toBe(opOf(0));
    expect(opOf(3)).not.toBe(opOf(0));
  });
});
