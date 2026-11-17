/* Équipe: « Envoyer encore » on a pending invitation opens « Inviter quelqu’un » filled from that invitation, with the
   short name and the language the server gives (settings-team-25, settings-team-r2-2). The server is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const invitation = { id: 'i1', email: 'kim@x.ca', full_name: 'Karim Haddad', short_name: 'Kim', lang: 'en', phone: null, roles: ['mechanic'], kind: 'invite',
  truck_id: null, expires_at: '2999-01-01T00:00:00Z', used_at: null, created_at: '2026-11-13T00:00:00Z' };
vi.mock('../../domain/team/teamApi', async (orig) => {
  const real = await orig<typeof import('../../domain/team/teamApi')>();
  return { ...real, loadTeamList: async () => ({ invitations: [invitation], sign_ins: {} }), loadRules: async () => undefined };
});
import TeamScreen from './TeamScreen';
import { replaceLocal } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (el: HTMLElement | null) => { expect(el).toBeTruthy(); await act(async () => { el!.click(); }); await wait(); };

beforeEach(async () => {
  lang.value = 'fr';
  access.value = { id: 'u-owner', roles: ['owner'], owner: true, prefs: {}, rights: {}, trucks: [] } as unknown as Access;
  replaceLocal('staff', [{ id: 'u-owner', full_name: 'Hassan Test', short_name: 'Hassan', email: 'h@x.test', phone: null, roles: ['owner'], rights: {}, active: true, color: '#D3000E', lang: 'fr', prefs: {}, last_seen_at: null }] as never);
  replaceLocal('trucks', []);
  replaceLocal('settings', [{ id: '1', role_rights: {} }] as never);
  await act(async () => { render(null, box); render(<TeamScreen params={{}} query={new URLSearchParams()} />, box); });
  await wait(); await wait();
});

describe('Équipe: « Envoyer encore » (settings-team-r2-2)', () => {
  it('the invitation’s short name and language fill the invite sheet again', async () => {
    await click(q('invitation-i1'));
    await click(q('invitation-again'));
    const sheet = q('invite-sheet');
    expect(sheet).toBeTruthy();
    expect((q('invite-name') as HTMLInputElement).value).toBe('Karim Haddad');
    expect((q('invite-email') as HTMLInputElement).value).toBe('kim@x.ca');
    const inputs = [...sheet!.querySelectorAll('input')] as HTMLInputElement[];
    // the short name is the field right after the full name
    expect(inputs[inputs.indexOf(q('invite-name') as HTMLInputElement) + 1].value).toBe('Kim');
    const english = [...sheet!.querySelectorAll('button')].find((b) => b.textContent === 'English')!;
    const french = [...sheet!.querySelectorAll('button')].find((b) => b.textContent === 'Français')!;
    expect(english.getAttribute('aria-pressed')).toBe('true');
    expect(french.getAttribute('aria-pressed')).toBe('false');
  });
});
