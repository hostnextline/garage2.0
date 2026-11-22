/* The pretend server of the demo (client.html?demo) answers « check » like the real « client » function (R10). */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

let realFetch: typeof fetch;
beforeAll(() => { realFetch = window.fetch; vi.useFakeTimers({ toFake: ['setTimeout'] }); });
afterAll(() => { window.fetch = realFetch; vi.useRealTimers(); sessionStorage.clear(); });

describe('the demo’s card payment', () => {
  it('« check » says « session »: open while the bank thinks, then paid', async () => {
    const { installClientDemo } = await import('./demo');
    const { callClient } = await import('./api');
    installClientDemo();
    const ask = async <T>(action: 'pay' | 'check') => {
      const p = callClient<T>(action, 'demo-unpaid');
      await vi.advanceTimersByTimeAsync(400);
      return p;
    };
    await ask('pay');
    expect((await ask<{ session?: string }>('check')).session).toBe('open');
    expect((await ask<{ session?: string }>('check')).session).toBe('paid');
    expect((await ask<{ session?: string }>('check')).session).toBe('none');
  });
});
