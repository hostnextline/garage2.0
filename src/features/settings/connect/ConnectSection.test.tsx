/* Réglages → Branchements lists TomTom with the other outside services (Part 27; review-settings R12, mutation M34: the
   section without its TomTom panel left every test green). The server is pretended; the other panels are left out. */
import { describe, it, expect, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { RoadsStatus } from '../../../data/roads';

let asked = 0;
vi.mock('../../../domain/team/teamApi', async (orig) => {
  const real = await orig<typeof import('../../../domain/team/teamApi')>();
  return { ...real, teamDo: async () => ({ ghl: false, stripe: false }) };
});
vi.mock('../../../data/roads', async (orig) => {
  const real = await orig<typeof import('../../../data/roads')>();
  const status: RoadsStatus = { ok: true, key: true, on: false, left: 0, left0: 0, month: { month: '2026-11-01', tx: 3, cap: 10000 }, rows: { tomtom: 0, osrm: 0, none: 0 } };
  return { ...real, roadsStatus: async () => { asked++; return status; } };
});
vi.mock('./GhlPanel', async (orig) => ({ ...(await orig<typeof import('./GhlPanel')>()), GhlPanel: () => null }));
vi.mock('./IncomingPanels', () => ({ RingPanel: () => null, TextsPanel: () => null }));
vi.mock('./StripePanel', () => ({ StripePanel: () => null }));
import { ConnectSection } from './ConnectSection';
import { lang } from '../../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
const settle = async () => { for (let i = 0; i < 6; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0))); };

describe('Réglages → Branchements', () => {
  it('has the line « TomTom » with its state, read from the server', async () => {
    lang.value = 'fr';
    await act(async () => { render(<ConnectSection />, box); });
    await settle();
    const panel = box.querySelector('[data-testid="connect-tomtom"]');
    expect(panel).toBeTruthy();
    expect(String(box.querySelector('[data-testid="tomtom-state"]')?.textContent).replace(/\s/g, ' ')).toBe('Branché');
    expect(asked).toBe(1);
    act(() => render(null, box));
  });
});
