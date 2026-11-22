/* « Mon compte » signs out through the one sign-out flow of the app (R104): this device's push address leaves first, the
   waiting changes are said once, exactly like « Plus ». Leaving the team signs out the same way. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls = vi.hoisted(() => ({ list: [] as string[], warn: 0 }));
vi.mock('../../shared/app/signOut', () => ({
  useSignOut: () => ({ warn: calls.warn, out: async () => { calls.list.push('useSignOut.out'); } }),
  signOutNow: async () => { calls.list.push('signOutNow'); }
}));
vi.mock('../../domain/team/teamApi', () => ({
  rolesWords: () => 'Mécanicien',
  teamDo: async (action: string) => { calls.list.push(`teamDo:${action}`); return { ok: true }; }
}));
vi.mock('../../ui', async (orig) => {
  const real = await orig<typeof import('../../ui')>();
  return { ...real, ask: async () => true };
});
import AccountScreen from './AccountScreen';
import { access } from '../../data/auth';
import type { Access } from '../../data/types';
import { setLang } from '../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const someone = { id: 'u1', full_name: 'Lara Test', short_name: 'Lara', email: 'lara@example.com', phone: null, roles: ['mechanic'], owner: false, lang: 'fr', prefs: {}, color: null, rights: {}, trucks: [] } as unknown as Access;

beforeEach(() => { calls.list = []; calls.warn = 0; access.value = someone; setLang('fr'); });
afterEach(async () => { await act(() => render(null, box)); access.value = null; });

const draw = () => act(() => render(<AccountScreen params={{}} query={new URLSearchParams()} />, box));

describe('Mon compte — me déconnecter', () => {
  it('the button runs the one sign-out flow of the app (push address first), not a sign-out of its own', async () => {
    await draw();
    const b = q('account-signout') as HTMLButtonElement;
    expect(b).not.toBeNull();
    await act(() => { b.click(); });
    await flush();
    expect(calls.list).toEqual(['useSignOut.out']);
  });
  it('changes still waiting: the warning of the shared flow is shown, and the button says « quand même »', async () => {
    calls.warn = 2;
    await draw();
    expect(box.textContent).toContain('2 changements');
    expect(q('account-signout')?.className).toMatch(/danger/);
  });
  it('leaving the team signs out through the same flow (the push address leaves too)', async () => {
    await draw();
    const b = q('account-leave') as HTMLButtonElement;
    await act(() => { b.click(); });
    await flush();
    // the kit's Button asks to confirm with a second tap
    const again = q('account-leave') as HTMLButtonElement;
    await act(() => { again.click(); });
    await flush(); await flush();
    expect(calls.list).toEqual(['teamDo:leave', 'signOutNow']);
  });
});
