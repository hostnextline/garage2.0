/* « Changer de client » waits for a customer just made on this phone to reach the server; the phone's storage refusing to
   be read must not leave the button spinning for good (jobs-r6). The outbox is pretended. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxEntry } from '../../data/local';

const box = vi.hoisted(() => ({ list: vi.fn<() => Promise<OutboxEntry[]>>() }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), outboxList: box.list }));

import { reached } from './JobEdit';

const insert = (id: string): OutboxEntry => ({ seq: 1, op: 'o1', kind: 'insert', table: 'customers', id, values: {}, at: '', tries: 0, state: 'pending' });

beforeEach(() => { box.list.mockReset(); });

describe('waiting for a new customer to reach the server', () => {
  it('the phone’s storage cannot be read (blocked, broken): it goes on at once instead of throwing', async () => {
    box.list.mockRejectedValue(new Error('IndexedDB blocked'));
    await expect(reached('customers', 'c9')).resolves.toBeUndefined();
  });
  it('waits while the customer is still in the outbox, then goes on', async () => {
    box.list.mockResolvedValueOnce([insert('c9')]).mockResolvedValueOnce([]);
    await expect(reached('customers', 'c9', 2000)).resolves.toBeUndefined();
    expect(box.list).toHaveBeenCalledTimes(2);
  });
});
