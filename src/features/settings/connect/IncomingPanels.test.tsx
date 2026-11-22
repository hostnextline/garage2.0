/* « Appels entrants »: the alert of this device for the calls (appel-notif), and the switch « dans mon compte » that says
   done only when the account really changed (settings-team-20). The server is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

let serverTakes = true;
const sent: unknown[] = [];
let pushOffs = 0;
vi.mock('../../../data/api', async (orig) => {
  const real = await orig<typeof import('../../../data/api')>();
  return { ...real, updateMe: async (p: { prefs: Record<string, unknown> }) => { sent.push(p); if (serverTakes) pending = { ...pending, ...p.prefs }; } };
});
let pending: Record<string, unknown> = {};
vi.mock('../../../data/auth', async (orig) => {
  const real = await orig<typeof import('../../../data/auth')>();
  return { ...real, refreshAccess: async () => { real.access.value = { ...real.access.value!, prefs: { ...real.access.value!.prefs, ...pending } }; } };
});
vi.mock('../../../services/push', () => ({ pushState: async () => 'off', pushOn: async () => undefined, pushOff: async () => { pushOffs++; } }));
import { RingPanel } from './IncomingPanels';
import { access } from '../../../data/auth';
import { toasts } from '../../../ui/toast';
import { lang } from '../../../lib/i18n';
import type { Access } from '../../../data/types';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const owner = (prefs: Record<string, unknown>) => ({ id: 'u1', full_name: 'Hassan', roles: ['owner'], owner: true, lang: 'fr', prefs, rights: {}, trucks: [] } as unknown as Access);
const show = async () => { await act(async () => { render(null, box); render(<RingPanel />, box); }); await wait(); };

beforeEach(() => { lang.value = 'fr'; serverTakes = true; sent.length = 0; pending = {}; pushOffs = 0; toasts.value = []; });

describe('Réglages → Branchements → Appels entrants', () => {
  it('with the calls in my account, this device can alert me while the app is closed', async () => {
    access.value = owner({ calls: true });
    await show();
    expect(q('calls-alert')).toBeTruthy();
    access.value = owner({});
    await show();
    expect(q('calls-alert')).toBeNull();
  });
  it('switching the calls off keeps the alert while the texts still need it', async () => {
    access.value = owner({ calls: true, texts: true });
    await show();
    await act(async () => { q('calls-mine')!.click(); });
    await wait(); await wait();
    expect(pushOffs).toBe(0);
    expect(toasts.value.at(-1)?.kind).toBe('ok');
  });
  it('the change did not reach the account: no « allumé », the person is told', async () => {
    access.value = owner({});
    serverTakes = false;
    await show();
    await act(async () => { q('calls-mine')!.click(); });
    await wait(); await wait();
    expect(sent).toEqual([{ prefs: { calls: true } }]);
    expect(toasts.value.at(-1)?.kind).toBe('bad');
    expect(toasts.value.at(-1)?.text).toContain('Pas changé');
  });
});
