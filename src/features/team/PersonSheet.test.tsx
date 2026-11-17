/* The person's sheet: giving the owner role asks first (settings-team-12); two quick colour changes are sent one after
   the other and the colour shown does not flicker back between them. The server is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const sent: Record<string, unknown>[] = [];
const asked: string[] = [];
let sayYes = false;
const answers: (() => void)[] = [];
const trucksSaved: Record<string, unknown>[] = [];
let refuse = false;
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return { ...real, memberUpdate: (_id: string, patch: Record<string, unknown>) => { sent.push(patch); if (refuse) return Promise.reject(new Error('refusé')); return new Promise<void>((r) => answers.push(r)); },
    saveTruck: async (tr: Record<string, unknown>) => { trucksSaved.push(tr); return String(tr.id); } };
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
  lang.value = 'fr'; sent.length = 0; asked.length = 0; sayYes = false; answers.length = 0; trucksSaved.length = 0; refuse = false;
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
  it('« Mécanicien » taken off: once the server said yes, the truck he drove is free again; refused, the truck stays (settings-team-26)', async () => {
    replaceLocal('trucks', [{ id: 't1', name: 'Camion', driver_id: 'u-saleh', active: true }, { id: 't2', name: 'Voiture', driver_id: 'u-other', active: true }] as never);
    replaceLocal('staff', [{ id: 'u-saleh', full_name: 'Saleh Amro', short_name: 'Saleh', email: 's@x.test', phone: null, roles: ['mechanic', 'office'], rights: {}, active: true, color: '#D3000E', lang: 'fr', prefs: {}, last_seen_at: null }] as never);
    await wait();
    // a role that keeps « Mécanicien »: the truck stays his
    await act(async () => { roleChip('Trésor').click(); });
    await wait();
    await act(async () => { answers.shift()?.(); });
    await wait();
    expect(trucksSaved).toEqual([]);
    // refused by the server: the truck stays
    refuse = true;
    await act(async () => { roleChip('Mécanicien').click(); });
    await wait(); await wait();
    expect(sent[sent.length - 1]).toEqual({ roles: ['office'] });
    expect(trucksSaved).toEqual([]);
    refuse = false;
    await act(async () => { roleChip('Mécanicien').click(); });
    await wait();
    expect(sent[sent.length - 1]).toEqual({ roles: ['office'] });
    await act(async () => { answers.shift()?.(); });
    await wait(); await wait();
    expect(trucksSaved).toEqual([{ id: 't1', driver_id: null }]);
  });
  const mechanicOffice = async () => {
    replaceLocal('trucks', [{ id: 't1', name: 'Camion', driver_id: 'u-saleh', active: true }] as never);
    replaceLocal('staff', [{ id: 'u-saleh', full_name: 'Saleh Amro', short_name: 'Saleh', email: 's@x.test', phone: null, roles: ['mechanic', 'office'], rights: {}, active: true, color: '#D3000E', lang: 'fr', prefs: {}, last_seen_at: null }] as never);
    await wait();
  };
  it('« Mécanicien » off then on again before the server answered: both are sent, the truck stays his (settings-team-r2-1)', async () => {
    await mechanicOffice();
    await act(async () => { roleChip('Mécanicien').click(); });
    await wait();
    await act(async () => { roleChip('Mécanicien').click(); });
    await wait();
    await act(async () => { answers.shift()?.(); });
    await wait(); await wait();
    await act(async () => { answers.shift()?.(); });
    await wait(); await wait();
    expect(sent).toEqual([{ roles: ['office'] }, { roles: ['office', 'mechanic'] }]);
    expect(trucksSaved).toEqual([]);
  });
  it('off then on, the « on » refused: the server holds « Bureau » only, so the truck is freed after the last answer (settings-team-r2-1)', async () => {
    await mechanicOffice();
    await act(async () => { roleChip('Mécanicien').click(); });
    await wait();
    await act(async () => { roleChip('Mécanicien').click(); });
    await wait();
    refuse = true;
    await act(async () => { answers.shift()?.(); });
    await wait(); await wait(); await wait();
    expect(sent).toEqual([{ roles: ['office'] }, { roles: ['office', 'mechanic'] }]);
    expect(trucksSaved).toEqual([{ id: 't1', driver_id: null }]);
  });
});
