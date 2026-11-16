/* The red button changes meaning under the finger (« Je pars » → « Je suis arrivé »): a late second tap must not do the
   next step (x-reactivity-03, jobs-a-26). The steps themselves are pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const steps = vi.hoisted(() => ({ doLeave: vi.fn(() => Promise.resolve()), doArrive: vi.fn(() => Promise.resolve()), doFinish: vi.fn(() => Promise.resolve(true)), doVin: vi.fn(() => Promise.resolve()) }));
vi.mock('./actions', () => steps);

import type { Job } from '../../data/types';
import type { NextStep } from '../../domain/jobs/steps';
import type { JobRights } from '../../domain/jobs/rights';
import { StepButton, MORPH_MS } from './StepButton';

const box = document.createElement('div');
document.body.appendChild(box);
const job = (id = 'j1') => ({ id, status: 'booked', customer_id: null, day: '2026-11-15', block: 'am' } as unknown as Job);
const rights = { act: true, invoice: true, payLater: false, mine: true } as JobRights;
const draw = (j: Job, s: NextStep) => act(() => render(<StepButton job={j} step={s} rights={rights} />, box));
const button = (kind: string) => box.querySelector(`[data-testid="step-${kind}"]`) as HTMLButtonElement;

beforeEach(() => { vi.useFakeTimers(); Object.values(steps).forEach((f) => f.mockClear()); });
afterEach(() => { act(() => render(null, box)); vi.useRealTimers(); });

describe('the red button', () => {
  it('a tap right after the step changed does nothing; the next step works once the pause is over', async () => {
    await draw(job(), { kind: 'leave' });
    expect(button('leave').disabled).toBe(false);
    await act(async () => { button('leave').click(); });
    expect(steps.doLeave).toHaveBeenCalledTimes(1);
    // « Je pars » is done: the same button is now « Je suis arrivé »
    await draw(job(), { kind: 'arrive' });
    expect(button('arrive').disabled).toBe(true);
    await act(async () => { button('arrive').click(); });
    expect(steps.doArrive).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(MORPH_MS + 20); });
    expect(button('arrive').disabled).toBe(false);
    await act(async () => { button('arrive').click(); });
    expect(steps.doArrive).toHaveBeenCalledTimes(1);
  });
  it('the pause keeps the button’s look (not the grey « disabled » of the kit)', async () => {
    await draw(job(), { kind: 'leave' });
    await draw(job(), { kind: 'arrive' });
    expect(box.querySelector('.jobs-stepbtn')?.classList.contains('is-cooling')).toBe(true);
  });
  it('« Ma journée »: the next customer’s « Je pars » after « Terminer » waits too (another job, same place)', async () => {
    await draw(job('j1'), { kind: 'finish' });
    await draw(job('j2'), { kind: 'leave' });
    await act(async () => { button('leave').click(); });
    expect(steps.doLeave).not.toHaveBeenCalled();
  });
  it('the first time the button appears it takes the tap at once', async () => {
    await draw(job(), { kind: 'arrive' });
    expect(button('arrive').disabled).toBe(false);
    await act(async () => { button('arrive').click(); });
    expect(steps.doArrive).toHaveBeenCalledTimes(1);
  });
  it('the steps done on the job sheet open its piece; on « Ma journée » they are a link to it', async () => {
    await draw(job(), { kind: 'unbilled', itemId: 'i9', paid: false, count: 1 });
    expect(box.querySelector('a[data-testid="step-unbilled"]')?.getAttribute('href')).toBe('#/job/j1?do=invoice');
    await draw(job(), { kind: 'answer', itemId: 'i3' });
    await act(async () => { vi.advanceTimersByTime(MORPH_MS + 20); });
    expect(box.querySelector('a[data-testid="step-answer"]')?.getAttribute('href')).toBe('#/job/j1?do=answer&item=i3');
  });
});
