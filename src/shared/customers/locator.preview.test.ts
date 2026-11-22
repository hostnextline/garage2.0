/* « Voir l'app comme… »: the background locator writes nothing and marks nothing as tried (app-shell-28, customers-a-25). */
import { describe, it, expect, vi } from 'vitest';
import { signal } from '@preact/signals';

const locate = vi.fn();
vi.mock('../places/locate', () => ({ locate }));
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<typeof import('../../data/auth')>()), preview: signal(true) }));
const { locateMissing } = await import('./locator');

describe('the locator while the owner previews someone', () => {
  it('looks nothing up and keeps nothing as tried', async () => {
    localStorage.removeItem('his.locate.tried');
    const run = await locateMissing({ force: true });
    expect(run).toEqual({ found: 0, missing: 0, offline: false, placed: {} });
    expect(locate).not.toHaveBeenCalled();
    expect(localStorage.getItem('his.locate.tried')).toBeNull();
  });
});
