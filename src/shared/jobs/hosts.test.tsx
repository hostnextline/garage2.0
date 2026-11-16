/* The questions of the job flow are drawn by one host, whoever mounts it (the job sheet, « Aujourd'hui », the frame), and
   are dropped when no screen shows them any more (x-reactivity-23, jobs-a-27, jobs-b-20). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { Job } from '../../data/types';
import { PartsHost, confirmParts } from './PartsSheet';
import { CarCheckHost, askCar } from './CarCheckSheet';
import { TextOutcomeHost } from './TextOutcome';
import { outcome } from './texts';

const box = document.createElement('div');
document.body.appendChild(box);
const job = { id: 'j1', customer_id: null, odometer_km: null } as unknown as Job;
const planned = [{ item_id: 'oil', name: 'Huile', unit: 'L', qty: 4.5, onHand: 20 }];
const count = (id: string) => document.querySelectorAll(`[data-testid="${id}"]`).length;
afterEach(() => { act(() => render(null, box)); });

describe('one host draws a question', () => {
  it('two hosts mounted at once (a screen and the frame): the sheet is shown once', async () => {
    await act(() => render(<><PartsHost /><PartsHost /><TextOutcomeHost /><TextOutcomeHost /></>, box));
    void confirmParts(job, planned);
    outcome.value = { status: 'off', message: 'Bonjour' };
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(count('parts-sheet')).toBe(1);
    expect(count('text-outcome')).toBe(1);
  });
  it('a second question replaces the first, whose promise is answered (never left pending)', async () => {
    await act(() => render(<CarCheckHost />, box));
    const first = askCar(job, null, true);
    const second = askCar(job, null, true);
    await expect(first).resolves.toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(count('car-check')).toBe(1);
    void second;
  });
  it('the last host gone (the person left for a screen with none): the question is dropped, not shown later elsewhere', async () => {
    vi.useFakeTimers();
    await act(() => render(<><PartsHost /><TextOutcomeHost /></>, box));
    const asked = confirmParts(job, planned);
    outcome.value = { status: 'off', message: 'Bonjour' };
    await act(() => render(null, box));
    await act(async () => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await expect(asked).resolves.toBeNull();
    expect(outcome.value).toBeNull();
  });
  it('a change of screen (one host goes, the next one comes at once) keeps the question', async () => {
    vi.useFakeTimers();
    await act(() => render(<div key="today"><PartsHost /></div>, box));
    let answered: unknown = 'not yet';
    void confirmParts(job, planned).then((v) => { answered = v; });
    await act(() => render(<section key="job"><PartsHost /></section>, box));
    await act(async () => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(answered).toBe('not yet');
    expect(count('parts-sheet')).toBe(1);
  });
});
