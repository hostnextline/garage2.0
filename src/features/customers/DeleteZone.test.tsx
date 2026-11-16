/* « Supprimer ce client »: a coming appointment blocks it, and the day is a signal, so an office computer left open
   overnight lets the file go once yesterday's appointment is past (review day-signal-partial, customers-b-15). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Customer, Job } from '../../data/types';

const JOBS: Job[] = [{ id: 'j1', customer_id: 'c1', vehicle_id: null, day: '2026-11-16', status: 'booked', block: 'am' } as Job];
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<typeof import('../../data/auth')>()), can: () => true }));
vi.mock('../../data/select', async (orig) => ({ ...(await orig<typeof import('../../data/select')>()), jobsOfCustomer: (id: string) => JOBS.filter((j) => j.customer_id === id) }));
const { DeleteZone } = await import('./DeleteZone');
const { currentDay } = await import('../../domain/oil/clock');
const { lang } = await import('../../lib/i18n');
lang.value = 'fr';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));
const btn = () => box.querySelector('[data-testid="customer-delete"]') as HTMLButtonElement;

describe('« Supprimer ce client » and the day of today', () => {
  it('blocked by an appointment of today; free the day after, without reopening the file', () => {
    const before = currentDay.value;
    act(() => { currentDay.value = '2026-11-16'; });
    act(() => render(<DeleteZone c={{ id: 'c1' } as Customer} onLeaving={() => undefined} onDeleted={() => undefined} />, box));
    expect(btn().disabled).toBe(true);
    expect(box.textContent).toContain('rendez-vous à venir');
    act(() => { currentDay.value = '2026-11-17'; });
    expect(btn().disabled).toBe(false);
    expect(box.textContent).not.toContain('rendez-vous à venir');
    act(() => { currentDay.value = before; });
  });
});
