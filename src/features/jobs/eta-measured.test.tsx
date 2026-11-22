/* « Vraies routes » on, `jobs.eta_measured` false (lead's decision 2, final-guess G1): a trip before that booked stop is not
   measured yet, so its planned arrival counts the fixed unknown time. Every screen that says the plan's time as an arrival
   says « heure : trajets pas encore mesurés » instead, and never « Hors plage » from it; true or null (switch off, a server
   without the column): the plan's time, as before. Rows are pretended here (the server writes the column). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { JobTicket } from '../../shared/jobs/JobTicket';
import { GridJob } from '../agenda/GridJob';
import { Chip } from '../agenda/Chip';
import { JobRow } from '../overview/JobRow';
import { TruckCard } from '../today/TruckCard';
import { MechanicDay } from '../today/MechanicDay';
import { MomentPanel } from './MomentPanel';
import { replaceLocal, upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import { clock, today } from '../../lib/dates';
import type { Access, Job, Truck } from '../../data/types';
import type { JobRights } from '../../domain/jobs/rights';
import type { TruckNow } from '../today/select';

const WORDS = 'heure : trajets pas encore mesurés';
const WORDS_I = /heure : trajets pas encore mesurés/i;
const DAY = today();
const PLAN = clock(580, 'fr');   // « 9 h 40 »: the arrival counted with the 20 unknown minutes
const B = (p: Partial<Job> = {}) => ({ id: 'j1', number: 7, customer_id: null, truck_id: 't1', day: DAY, block: 'am', status: 'booked', stop_order: 2, duration_min: 60,
  eta_min: 580, travel_min: 25, deleted_at: null, ...p }) as unknown as Job;
/** booked by arrival window, 9 h – 13 h, its plan at 15 h (outside it) */
const W = (p: Partial<Job> = {}) => B({ block: 'day', win_start: 540, win_end: 780, eta_min: 900, ...p } as Partial<Job>);
const T = { id: 't1', name: 'Camion', active: true, sort: 1, color: '#D3000E', driver_id: 'saleh' } as unknown as Truck;
const box = document.createElement('div');
document.body.appendChild(box);
const noop = () => {};
const txt = () => box.textContent || '';
const show = (node: preact.ComponentChild, jobs: Job[]) => { replaceLocal('jobs', jobs as never); act(() => render(node, box)); };

beforeEach(() => {
  clearAll();
  lang.value = 'fr';
  access.value = { id: 'saleh', roles: ['owner'], owner: true, rights: { agenda: true }, trucks: ['t1'] } as unknown as Access;
  replaceLocal('trucks', [T] as never);
});
afterEach(() => { act(() => render(null, box)); access.value = null; lang.value = 'fr'; });

describe('the ticket (agenda, customer file, « Ma journée »)', () => {
  it('not measured: the words, no time; measured or no flag: « Vers 9 h 40 » as before', () => {
    show(<JobTicket job={B({ eta_measured: false })} />, [B({ eta_measured: false })]);
    expect(txt()).toMatch(WORDS_I);   // the ticket starts its time with a capital
    expect(txt()).not.toContain(PLAN);
    show(<JobTicket job={B({ eta_measured: true })} />, [B({ eta_measured: true })]);
    expect(txt()).toContain(PLAN);
    show(<JobTicket job={B()} />, [B()]);
    expect(txt()).toContain(PLAN);
  });
  it('in English too', () => {
    lang.value = 'en';
    show(<JobTicket job={B({ eta_measured: false })} />, [B({ eta_measured: false })]);
    expect(txt()).toMatch(/time: trips not measured yet/i);
  });
});

describe('« Ma journée »', () => {
  it('« Ensuite »: the words; « Ta journée en bref » says its driving counts trips not measured yet', () => {
    access.value = { id: 'saleh', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
    const first = B({ id: 'j0', number: 6, stop_order: 1, eta_min: 520, eta_measured: true });
    act(() => { replaceLocal('jobs', [first, B({ eta_measured: false })] as never); render(<MechanicDay />, box); });
    const then = box.querySelector('[aria-labelledby="today-then"]')!.textContent || '';
    expect(then).toMatch(WORDS_I);
    expect(then).not.toContain(PLAN);
    expect(box.querySelector('[data-testid="today-summary"]')!.textContent).toContain('trajets pas encore tous mesurés');
    act(() => { replaceLocal('jobs', [first, B({ eta_measured: true })] as never); });
    expect(box.querySelector('[data-testid="today-summary"]')!.textContent).not.toContain('pas encore');
  });
  it('« Ta journée en bref »: its « ? » says the real roads while the switch is on, the estimate of before while off (G3)', () => {
    access.value = { id: 'saleh', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
    const help = (on: boolean) => {
      upsertLocal('settings', [{ id: '1', booking: { roads_on: on } } as never], { force: true });
      act(() => { replaceLocal('jobs', [B()] as never); render(<MechanicDay />, box); });
      const b = box.querySelector('[data-testid="today-summary"] .help') as HTMLButtonElement;
      act(() => { b.click(); });
      const said = document.querySelector('.help-pop')?.textContent || '';
      act(() => { b.click(); render(null, box); });
      return said;
    };
    expect(help(true)).toContain('vraies routes');
    expect(help(true)).not.toContain('sans le trafic');
    expect(help(false)).toContain('sans le trafic');
  });
  it('« La journée », a truck’s next stop: the words, not « vers 9 h 40 »', () => {
    const x = (n: Job): TruckNow => ({ truck: T, jobs: [n], done: 0, total: 1, next: n, state: 'not_started', shiftOpen: false, posAt: null });
    show(<TruckCard x={x(B({ eta_measured: false }))} now={Date.now()} day={DAY} />, [B({ eta_measured: false })]);
    expect(txt()).toContain(WORDS);
    expect(txt()).not.toContain(PLAN);
    show(<TruckCard x={x(B({ eta_measured: true }))} now={Date.now()} day={DAY} />, [B({ eta_measured: true })]);
    expect(txt()).toContain(PLAN);
  });
});

describe('the job’s « Le rendez-vous » panel', () => {
  const rights = { move: false, order: false, duration: false } as unknown as JobRights;
  it('the stop: « 2, heure : trajets pas encore mesurés »; a window job is never « Hors plage » from it', () => {
    show(<MomentPanel job={B({ eta_measured: false })} rights={rights} onMove={noop} onOrder={noop} />, [B({ eta_measured: false })]);
    expect(txt()).toContain(`2, ${WORDS}`);
    expect(txt()).not.toContain(PLAN);
    show(<MomentPanel job={W({ eta_measured: false })} rights={rights} onMove={noop} onOrder={noop} />, [W({ eta_measured: false })]);
    expect(box.querySelector('[data-testid="job-window-late"]')).toBeNull();
    expect(box.querySelector('[data-testid="job-late"]')).toBeNull();
    show(<MomentPanel job={W({ eta_measured: true })} rights={rights} onMove={noop} onOrder={noop} />, [W({ eta_measured: true })]);
    expect(box.querySelector('[data-testid="job-window-late"]')).not.toBeNull();
  });
});

describe('the agenda (grid and lanes) and « Vue d’ensemble »', () => {
  const grid = (j: Job) => {
    show(<GridJob job={j} box={{ top: 0, height: 6 }} slot={{ col: 0, cols: 1 }} compact={false} draggable={false} dragging={false} onDragStart={noop} onDragEnd={noop} />, [j]);
    return box.querySelector('[data-testid="grid-job-j1"]')!;
  };
  it('the grid: the words in what the block says, no time, never « Hors plage »', () => {
    const g = grid(B({ eta_measured: false }));
    expect(g.getAttribute('aria-label')).toContain(WORDS);
    expect(g.getAttribute('aria-label')).not.toContain(PLAN);
    expect(g.textContent).not.toContain(PLAN);
    const w = grid(W({ eta_measured: false }));
    expect(w.getAttribute('aria-label')).not.toContain('Hors plage');
    expect(grid(W({ eta_measured: true })).getAttribute('aria-label')).toContain('Hors plage');
    expect(grid(B({ eta_measured: true })).getAttribute('aria-label')).toContain(PLAN);
  });
  it('a lane’s ticket (window mode): the words, never « Hors plage »', () => {
    const chip = (j: Job) => { show(<Chip job={j} draggable={false} dragging={false} onDragStart={noop} onDragEnd={noop} />, [j]); return box.querySelector('[data-testid="chip-j1"]')!.getAttribute('aria-label') || ''; };
    const c = chip(W({ eta_measured: false }));
    expect(c).toContain(WORDS);
    expect(c).not.toContain(clock(900, 'fr'));
    expect(c).not.toContain('Hors plage');
    expect(chip(W({ eta_measured: true }))).toContain('Hors plage');
  });
  it('« Vue d’ensemble »: « — » and the words; measured: the time', () => {
    const row = (j: Job) => { show(<JobRow r={{ job: j, n: 2, color: '#D3000E', truckName: 'Camion' } as never} on={false} />, [j]); return box; };
    const r = row(B({ eta_measured: false }));
    expect(r.querySelector('.overview-time')!.textContent).toBe('—');
    expect(r.querySelector('[data-testid="overview-unsure-j1"]')!.textContent).toBe(WORDS);
    const s = row(B({ eta_measured: true }));
    expect(s.querySelector('.overview-time')!.textContent).toBe(PLAN);
    expect(s.querySelector('[data-testid="overview-unsure-j1"]')).toBeNull();
    // a window job not measured: never « Hors plage »
    expect(row(W({ eta_measured: false })).textContent).not.toContain('Hors plage');
  });
});
