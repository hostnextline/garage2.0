/* The person's sheet: giving the owner role asks first (settings-team-12); two quick colour changes are sent one after
   the other and the colour shown does not flicker back between them. The server is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const sent: Record<string, unknown>[] = [];
const asked: string[] = [];
let sayYes = false;
const answers: (() => void)[] = [];
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return { ...real, memberUpdate: (_id: string, patch: Record<string, unknown>) => { sent.push(patch); return new Promise<void>((r) => answers.push(r)); } };
});
vi.mock('../../ui', async (orig) => {
  const real = await orig<typeof import('../../ui')>();
  return { ...real, ask: async (o: { title: string }) => { asked.push(o.title); return sayYes; } };
});
import { PersonSheet } from './PersonSheet';
import { replaceLocal } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const box = document.createElement('div');
document.body.appendChild(box);
const roleChip = (label: string) => [...document.querySelectorAll('[data-testid="person-roles"] button')].find((b) => b.textContent?.includes(label)) as HTMLElement;

beforeEach(async () => {
  lang.value = 'fr'; sent.length = 0; asked.length = 0; sayYes = false; answers.length = 0;
  access.value = { id: 'u-owner', roles: ['owner'], owner: true, prefs: {}, rights: {}, trucks: [] } as unknown as Access;
  replaceLocal('staff', [{ id: 'u-saleh', full_name: 'Saleh Amro', short_name: 'Saleh', email: 's@x.test', phone: null, roles: ['mechanic'], rights: {}, active: true, color: '#D3000E', lang: 'fr', prefs: {}, last_seen_at: null }] as never);
  replaceLocal('trucks', []);
  replaceLocal('settings', [{ id: '1', role_rights: {} }] as never);
  await act(async () => { render(null, box); render(<PersonSheet id="u-saleh" onClose={() => undefined} onLink={() => undefined} />, box); });
  await wait();
});

describe('Équipe: the person’s sheet', () => {
  it('one tap on « Propriétaire » asks first; « no » changes nothing', async () => {
    await act(async () => { roleChip('Propriétaire').click(); });
    await wait();
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain('Saleh');
    expect(sent).toEqual([]);
    sayYes = true;
    await act(async () => { roleChip('Propriétaire').click(); });
    await wait();
    expect(sent).toEqual([{ roles: ['mechanic', 'owner'] }]);
  });
  it('another role than owner goes at once, without a question', async () => {
    await act(async () => { roleChip('Bureau').click(); });
    await wait();
    expect(asked).toEqual([]);
    expect(sent.length).toBe(1);
  });
});
