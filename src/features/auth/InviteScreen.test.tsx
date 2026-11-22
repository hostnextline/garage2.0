/* The invitation link: without signal it is kept and « Réessayer » asks again (app-shell-10); accepted but the sign-in
   fails: the sign-in screen says why (app-shell-31). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls = vi.hoisted(() => ({ answers: [] as unknown[], signIn: null as string | null }));
vi.mock('../../data/auth', async (orig) => {
  const real = await orig<typeof import('../../data/auth')>();
  return {
    ...real,
    // once the link is cleared the real app unmounts this screen; here it stays, and asks once more
    callFn: vi.fn(async () => { const a = calls.answers.shift() ?? { ok: false, error: 'gone' }; if (a instanceof Error) throw a; return a; }),
    signIn: vi.fn(async () => calls.signIn),
    clearInvite: vi.fn(() => { real.inviteToken.value = null; })
  };
});
import { inviteToken, authState } from '../../data/auth';
import { InviteScreen } from './InviteScreen';
import { gateNotice } from './notice';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const info = { ok: true, name: 'Adam', email: 'adam@his.test', roles: ['mechanic'], kind: 'invite', lang: 'fr', garage: 'H.I.S' };

describe('the invitation link', () => {
  it('no signal: the link stays, « Réessayer » asks again and the form comes', async () => {
    inviteToken.value = 'tok-123456789012345678901';
    calls.answers = [new TypeError('Failed to fetch'), info];
    await act(() => render(<InviteScreen />, box)); await flush();
    expect(q('invite-retry')).not.toBeNull();
    expect(inviteToken.value).toBe('tok-123456789012345678901');
    await act(() => { q('invite-retry')!.click(); }); await flush();
    expect(q('invite-submit')).not.toBeNull();
  });
  it('a refused link: only « Aller à la connexion »', async () => {
    inviteToken.value = 'tok-123456789012345678902';
    calls.answers = [{ ok: false, code: 'expired', error: 'Ce lien a expiré.' }];
    await act(() => render(<InviteScreen />, box)); await flush();
    expect(q('invite-retry')).toBeNull();
    expect(box.textContent).toContain('Ce lien a expiré.');
  });
  it('accepted, then signing in fails: the reason waits for the sign-in screen', async () => {
    inviteToken.value = 'tok-123456789012345678903';
    calls.answers = [info, { ok: true, email: 'adam@his.test' }];
    calls.signIn = 'auth.wrong';
    await act(() => render(<InviteScreen />, box)); await flush();
    const pw = box.querySelectorAll('input[type="password"]');
    for (const el of pw) await act(() => { (el as HTMLInputElement).value = 'une phrase longue'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(() => { q('invite-submit')!.click(); }); await flush(); await flush();
    expect(authState.value).toBe('signed_out');
    expect(gateNotice.value).toMatch(/mot de passe est choisi|password is set/);
  });
});
