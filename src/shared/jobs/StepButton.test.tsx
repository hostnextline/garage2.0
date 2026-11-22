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
import { StepButton, MORPH_MS, HOLD_MAX_MS } from './StepButton';

const box = document.createElement('div');
document.body.appendChild(box);
const job = (id = 'j1') => ({ id, status: 'booked', customer_id: null, day: '2026-11-15', block: 'am' } as unknown as Job);
const rights = { act: true, invoice: true, payLater: false, mine: true } as JobRights;
const draw = (j: Job, s: NextStep) => act(() => render(<StepButton job={j} step={s} rights={rights} />, box));
const button = (kind: string) => box.querySelector(`[data-testid="step-${kind}"]`) as HTMLButtonElement;

// each test an hour after the last (the step settled in one test is long past in the next)
let clock = Date.now();
beforeEach(() => { vi.useFakeTimers(); clock += 3600000; vi.setSystemTime(clock); Object.values(steps).forEach((f) => f.mockClear()); });
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
  it('weak signal: « Je pars » shows done before the server answered; « Je suis arrivé » takes no tap until it is settled, then for the pause (jobs-r1)', async () => {
    let answer: () => void = () => undefined;
    steps.doLeave.mockImplementationOnce(() => new Promise<void>((r) => { answer = r; }));
    await draw(job(), { kind: 'leave' });
    await act(async () => { button('leave').click(); });
    expect(steps.doLeave).toHaveBeenCalledTimes(1);
    // kept in the outbox: the same button is already « Je suis arrivé », the server has not answered yet
    await draw(job(), { kind: 'arrive' });
    // 0.7 to 8 s later, still no answer: closed to taps
    for (const ms of [MORPH_MS + 20, 3000, 4000]) {
      await act(async () => { vi.advanceTimersByTime(ms); });
      expect(button('arrive').disabled).toBe(true);
      await act(async () => { button('arrive').click(); });
    }
    // the answer lands: a tap right after it (the finger was already coming down) does nothing either
    await act(async () => { answer(); await Promise.resolve(); });
    expect(button('arrive').disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => { button('arrive').click(); });
    expect(steps.doArrive).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(MORPH_MS); });
    expect(button('arrive').disabled).toBe(false);
    await act(async () => { button('arrive').click(); });
    expect(steps.doArrive).toHaveBeenCalledTimes(1);
  });
  it('« Ma journée »: « Terminer » still on its way holds the next customer’s « Je pars » at the same place, and for the pause after', async () => {
    let answer: (v: boolean) => void = () => undefined;
    steps.doFinish.mockImplementationOnce(() => new Promise<boolean>((r) => { answer = r; }));
    await draw(job('j1'), { kind: 'finish' });
    await act(async () => { button('finish').click(); });
    await draw(job('j2'), { kind: 'leave' });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(button('leave').disabled).toBe(true);
    await act(async () => { answer(true); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => { button('leave').click(); });
    expect(steps.doLeave).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(MORPH_MS); });
    await act(async () => { button('leave').click(); });
    expect(steps.doLeave).toHaveBeenCalledTimes(1);
  });
  it('a step stepped back from (the parts sheet closed): the same step takes the next tap at once', async () => {
    steps.doFinish.mockImplementationOnce(() => Promise.resolve(false));
    await draw(job(), { kind: 'finish' });
    await act(async () => { button('finish').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(button('finish').disabled).toBe(false);
    await act(async () => { button('finish').click(); });
    expect(steps.doFinish).toHaveBeenCalledTimes(2);
  });
  it('a step that never settles (a lost answer) does not freeze the button for good', async () => {
    let answer: () => void = () => undefined;
    steps.doLeave.mockImplementationOnce(() => new Promise<void>((r) => { answer = r; }));
    await draw(job('j7'), { kind: 'leave' });
    await act(async () => { button('leave').click(); });
    await draw(job('j7'), { kind: 'arrive' });
    await act(async () => { vi.advanceTimersByTime(HOLD_MAX_MS + 20); });
    expect(button('arrive').disabled).toBe(false);
    await act(async () => { answer(); await Promise.resolve(); });
  });
  it('the steps done on the job sheet open its piece; on « Ma journée » they are a link to it', async () => {
    await draw(job(), { kind: 'unbilled', itemId: 'i9', paid: false, count: 1 });
    expect(box.querySelector('a[data-testid="step-unbilled"]')?.getAttribute('href')).toBe('#/job/j1?do=invoice');
    await draw(job(), { kind: 'answer', itemId: 'i3' });
    await act(async () => { vi.advanceTimersByTime(MORPH_MS + 20); });
    expect(box.querySelector('a[data-testid="step-answer"]')?.getAttribute('href')).toBe('#/job/j1?do=answer&item=i3');
  });
});
