/* « Inviter quelqu’un » / « Envoyer encore »: what is sent to the server, and a refusal shown on its field
   (settings-team-18, settings-team-25). The server is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const sent: Record<string, unknown>[] = [];
let refuse: { code: string; message: string } | null = null;
vi.mock('../../domain/team/teamApi', async (orig) => {
  const real = await orig<typeof import('../../domain/team/teamApi')>();
  return { ...real, teamDo: async (_a: string, body: Record<string, unknown>) => {
    sent.push(body);
    if (refuse) throw Object.assign(new Error(refuse.message), refuse);
    return { link: 'https://x/l', sent: 'sent' };
  } };
});
import { InviteSheet } from './InviteSheet';
import { againDraft } from './again';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';

const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const inv = { id: 'i1', email: 'kim@x.ca', full_name: 'Karim Haddad', roles: ['mechanic' as const], kind: 'invite' as const, truck_id: null,
  expires_at: '2026-11-20T00:00:00Z', used_at: null, created_at: '2026-11-13T00:00:00Z' };
const open = async (prefill: ReturnType<typeof againDraft>) => {
  await act(async () => { render(null, box); render(<InviteSheet open again prefill={prefill} onClose={() => undefined} onLink={() => undefined} onSent={() => undefined} />, box); });
  await wait();
};

beforeEach(() => { lang.value = 'fr'; sent.length = 0; refuse = null; replaceLocal('trucks', []); });

describe('Équipe: the invitation sheet', () => {
  it('« Envoyer encore » with the server’s short name and language: they are sent again (settings-team-25)', async () => {
    await open(againDraft({ ...inv, short_name: 'Kim', lang: 'en' }));
    await act(async () => { q('invite-send')!.click(); });
    await wait();
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ full_name: 'Karim Haddad', short_name: 'Kim', email: 'kim@x.ca', lang: 'en', roles: ['mechanic'] });
  });
  it('an older server (no short name, no language): French and no short name, as before', async () => {
    await open(againDraft(inv));
    await act(async () => { q('invite-send')!.click(); });
    await wait();
    expect(sent[0]).toMatchObject({ short_name: null, lang: 'fr' });
  });
  it('the server says the person already has an account: said under the e-mail', async () => {
    refuse = { code: 'exists', message: 'Cette personne a déjà un compte.' };
    await open(againDraft(inv));
    await act(async () => { q('invite-send')!.click(); });
    await wait();
    const errs = [...document.querySelectorAll('[data-testid="invite-sheet"] .field-error')].map((e) => e.textContent);
    expect(errs).toEqual(['Cette personne a déjà un compte.']);
  });
});
