/* The service sheet keeps what is being typed when the row comes back from the server (settings-team-09), and asks
   before closing with changes (settings-team-24b). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const asked: string[] = [];
let sayYes = false;
vi.mock('../../../ui', async (orig) => {
  const real = await orig<typeof import('../../../ui')>();
  return { ...real, ask: async (o: { title: string }) => { asked.push(o.title); return sayYes; } };
});
import { ServiceSheet } from './ServiceSheet';
import { replaceLocal } from '../../../data/store';
import { lang } from '../../../lib/i18n';
import { whenHistorySettled } from '../../../platform/history';

const row = (x: Record<string, unknown> = {}) => ({ id: 's1', name_fr: 'Huile', name_en: null, category: 'entretien', price_cents: 7999, duration_min: 45, taxable: true, needs_machine: false, is_promo: false, promo_until: null, includes: [], active: true, sort: 3, needs: null, updated_at: '2026-11-15T10:00:00Z', ...x });
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const settled = () => act(() => new Promise<void>((r) => whenHistorySettled(() => setTimeout(r, 0))));
let closed = 0;

beforeEach(async () => {
  lang.value = 'fr'; asked.length = 0; sayYes = false; closed = 0;
  replaceLocal('services', [row()] as never);
  replaceLocal('service_parts', []);
  replaceLocal('inventory_items', []);
  // the sheet of the test before and its history step go first, then this one opens and its step is in place
  await act(async () => { render(null, box); });
  await settled();
  await act(async () => { render(<ServiceSheet id="s1" onClose={() => { closed++; }} />, box); });
  await wait();
  await settled();
});

describe('Réglages → Services: the sheet', () => {
  it('a name being typed stays when the row comes back with a new date and another field changed elsewhere', async () => {
    const name = q('service-name') as HTMLInputElement;
    await act(async () => { name.value = 'Huile synthétique'; name.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { replaceLocal('services', [row({ updated_at: '2026-11-15T10:05:00Z', sort: 9, price_cents: 8999 })] as never); });
    await wait();
    expect((q('service-name') as HTMLInputElement).value).toBe('Huile synthétique');
    expect((q('service-save') as HTMLButtonElement).disabled).toBe(false);
  });
  it('closing with changes asks first; « no » keeps the sheet open', async () => {
    const name = q('service-name') as HTMLInputElement;
    await act(async () => { name.value = 'Huile 2'; name.dispatchEvent(new Event('input', { bubbles: true })); });
    const x = document.querySelector('[data-testid="service-sheet"] .sheet-x, [data-testid="service-sheet"] button[aria-label="Fermer"]') as HTMLElement | null;
    expect(x).toBeTruthy();
    await act(async () => { x!.click(); });
    await wait();
    expect(asked.length).toBe(1);
    expect(closed).toBe(0);
  });
  it('a space typed after the saved name stays, so a second word can follow (settings-team-st-1)', async () => {
    const name = q('service-name') as HTMLInputElement;
    await act(async () => { name.value = 'Huile '; name.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait();
    expect((q('service-name') as HTMLInputElement).value).toBe('Huile ');
    const again = q('service-name') as HTMLInputElement;
    await act(async () => { again.value = 'Huile s'; again.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait();
    expect((q('service-name') as HTMLInputElement).value).toBe('Huile s');
  });
  it('the phone\'s back with changes asks; « no » puts the sheet\'s history step back, so the next back asks again (settings-team-st-3)', async () => {
    const steps = () => ((history.state as { sheets?: string[] } | null)?.sheets || []).length;
    const before = steps();
    const name = q('service-name') as HTMLInputElement;
    await act(async () => { name.value = 'Huile 2'; name.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { history.back(); });
    await act(() => new Promise<void>((r) => setTimeout(r, 700)));
    await wait();
    expect(asked.length).toBe(1);
    expect(closed).toBe(0);
    expect(steps()).toBe(before);
    expect(q('service-sheet')).toBeTruthy();
    expect((q('service-name') as HTMLInputElement).value).toBe('Huile 2');
    // the next back asks again instead of leaving Services
    await act(async () => { history.back(); });
    await act(() => new Promise<void>((r) => setTimeout(r, 700)));
    await wait();
    expect(asked.length).toBe(2);
    expect(closed).toBe(0);
  });
});
