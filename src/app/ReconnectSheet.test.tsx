/* « Me reconnecter » signs in again as the account whose changes wait, never as someone else. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const { signed, me } = vi.hoisted(() => ({ signed: [] as string[], me: { value: null as { email?: string | null } | null } }));
vi.mock('../data/auth', () => ({ me, signIn: async (email: string) => { signed.push(email); return null; } }));
import { ReconnectSheet, reconnectOpen } from './ReconnectSheet';
import { lang } from '../lib/i18n';

let root: HTMLDivElement;
beforeEach(() => {
  lang.value = 'fr';
  signed.length = 0;
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  reconnectOpen.value = false;
  localStorage.removeItem('his.email');
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const type = (el: HTMLInputElement, v: string) => act(() => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); });

describe('« Me reconnecter »', () => {
  it('the e-mail of the lost session is fixed: the changes waiting go out under the same account', async () => {
    localStorage.setItem('his.email', 'ibrahim@exemple.ca');
    reconnectOpen.value = true;
    act(() => { render(<ReconnectSheet />, root); });
    await flush();
    const email = document.querySelector<HTMLInputElement>('[data-testid="reconnect-email"]')!;
    expect(email.value).toBe('ibrahim@exemple.ca');
    expect(email.readOnly).toBe(true);
    type(email, 'autre@exemple.ca');
    type(document.querySelector<HTMLInputElement>('input[type="password"]')!, 'secret');
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="reconnect-submit"]')!.click(); });
    await flush();
    expect(signed).toEqual(['ibrahim@exemple.ca']);
  });
  it('no account known on this phone: the field is open', async () => {
    reconnectOpen.value = true;
    act(() => { render(<ReconnectSheet />, root); });
    await flush();
    expect(document.querySelector<HTMLInputElement>('[data-testid="reconnect-email"]')!.readOnly).toBe(false);
  });
});
