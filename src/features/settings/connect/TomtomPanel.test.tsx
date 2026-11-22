/* Réglages → Branchements → TomTom (Part 27): read only, like the other outside services. The server's key from the
   function « drive » (roadsStatus, pretended here), the browser key from the build; never a key typed or shown. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { RoadsStatus } from '../../../data/roads';

let status: RoadsStatus | Error = { ok: true, key: true, on: false, left: 0, left0: 0, month: { month: '2026-11-01', tx: 1880, cap: 10000 }, rows: { tomtom: 0, osrm: 0, none: 0 } };
let asked = 0;
vi.mock('../../../data/roads', async (orig) => {
  const real = await orig<typeof import('../../../data/roads')>();
  return { ...real, roadsStatus: async () => { asked++; if (status instanceof Error) throw status; return status; } };
});
import { TomtomPanel } from './TomtomPanel';
import { lang } from '../../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const sp = (s: string | null | undefined) => String(s).replace(/\s/g, ' ');
const settle = async () => { for (let i = 0; i < 6; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0))); };
const show = async (browserKey = '') => { await act(async () => { render(null, box); render(<TomtomPanel browserKey={browserKey} />, box); }); await settle(); };

beforeEach(() => { lang.value = 'fr'; asked = 0; status = { ok: true, key: true, on: false, left: 0, left0: 0, month: { month: '2026-11-01', tx: 1880, cap: 10000 }, rows: { tomtom: 0, osrm: 0, none: 0 } }; });

describe('Branchements → TomTom', () => {
  it('the server has its key: « Branché », the month’s spend; this build without the maps key says so', async () => {
    await show('');
    expect(sp(q('tomtom-state')!.textContent)).toBe('Branché');
    expect(sp(q('tomtom-server')!.textContent)).toBe('Le serveur a la clé de TomTom.');
    expect(sp(q('tomtom-month')!.textContent)).toBe('Ce mois-ci : 1 880 transactions sur 10 000.');
    expect(sp(q('tomtom-browser')!.textContent)).toContain('n’a pas la clé des cartes');
    expect(box.querySelectorAll('input').length).toBe(0);
  });
  it('no server key: « Pas branché », the real roads without traffic; a build with the maps key', async () => {
    status = { ok: true, key: false, on: false, left: 3, left0: 0, month: null, rows: { tomtom: 0, osrm: 3, none: 0 } };
    await show('tt-browser');
    expect(sp(q('tomtom-state')!.textContent)).toBe('Pas branché');
    expect(sp(q('tomtom-server')!.textContent)).toContain('sans la circulation (OSRM)');
    expect(q('tomtom-month')).toBeNull();
    expect(sp(q('tomtom-browser')!.textContent)).toContain('cartes et adresses de TomTom');
    // the browser key itself is never written on the screen
    expect(box.textContent).not.toContain('tt-browser');
  });
  it('the function not installed, no network: « Je ne sais pas » and why, with « Réessayer »', async () => {
    status = { ok: false, code: 'NOT_FOUND', error: 'Requested function was not found', at: 'drive' };
    await show();
    expect(sp(q('tomtom-state')!.textContent)).toBe('Je ne sais pas');
    expect(sp(q('tomtom-error')!.textContent)).toContain('pas encore installée sur le serveur');
    status = new TypeError('Failed to fetch');
    await act(async () => { q('tomtom-retry')!.click(); });
    await settle();
    expect(sp(q('tomtom-error')!.textContent)).toContain('Vérifie Internet');
    expect(asked).toBe(2);
  });
  it('in English', async () => {
    lang.value = 'en';
    await show();
    expect(sp(q('tomtom-state')!.textContent)).toBe('Connected');
    expect(sp(q('tomtom-server')!.textContent)).toBe('The server has TomTom’s key.');
  });
});
