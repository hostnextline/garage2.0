/* The job screen once a job is done: « Ensuite », the truck's next stop for its mechanic. A stop already on the way says the
   trip's real arrival or no time, never the plan's time said as an arrival (task point 4; review-sheets L4). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { StepState } from './StepState';
import { replaceLocal, clearAll } from '../../data/store';
import { lang } from '../../lib/i18n';
import { clock, today } from '../../lib/dates';
import type { Job } from '../../data/types';
import type { NextStep } from '../../domain/jobs/steps';
import type { JobRights } from '../../domain/jobs/rights';

const DAY = today();
const DONE = { id: 'd1', number: 4, customer_id: null, truck_id: 't1', day: DAY, block: 'am', status: 'done', stop_order: 1, duration_min: 60, eta_min: 500, deleted_at: null } as unknown as Job;
const NEXT = { ...DONE, id: 'n2', number: 5, status: 'en_route', stop_order: 2, eta_min: 600 } as unknown as Job;
const box = document.createElement('div');
document.body.appendChild(box);
const show = () => act(() => render(<StepState job={DONE} step={{ kind: 'done', paid: true, due: 0 } as unknown as NextStep} rights={{ mine: true } as unknown as JobRights} onCollect={() => undefined} />, box));

beforeEach(() => {
  clearAll();
  lang.value = 'fr';
  replaceLocal('trucks', [{ id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: null }] as never);
});
afterEach(() => { act(() => render(null, box)); });

describe('« Ensuite » under a finished job', () => {
  it('the next stop on the way, no trip time: no time said (before: « Vers 10 h », the plan’s)', () => {
    replaceLocal('jobs', [DONE, NEXT] as never);
    show();
    const next = box.querySelector('.jobs-next')!.textContent || '';
    expect(next).toContain('Client sans nom');
    expect(next).not.toContain(clock(600, 'fr'));
  });
  it('a booked next stop keeps its planned time', () => {
    replaceLocal('jobs', [DONE, { ...NEXT, status: 'booked' }] as never);
    show();
    expect(box.querySelector('.jobs-next')!.textContent).toContain(`Vers ${clock(600, 'fr')}`);
  });
});
