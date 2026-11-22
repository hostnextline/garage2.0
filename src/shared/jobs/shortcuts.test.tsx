/* « Déplacer » from the trucks' stops (Hassan, 2026-11-21): the agenda's shortcut menu of an appointment, shared by every
   list of a truck's stops (Carte, Vue d'ensemble, Aujourd'hui). The same rule as the agenda: « Déplacer » only for an
   appointment still booked, for a person with the « Réserver » right, and never while a move of it waits on the phone.
   Given `onMove`, « Déplacer » opens the sheet on the screen itself; without it (the agenda), the appointment's screen. */
import { describe, it, expect, afterEach } from 'vitest';
import { access } from '../../data/auth';
import { route } from '../../platform/router';
import type { Access, Job } from '../../data/types';
import { jobActions, menuProps } from './shortcuts';
import { mayMove, movesWaiting, setWaiting } from './moving';

const owner = { id: 'hassan', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const office = { id: 'nadia', owner: false, roles: ['office'], rights: { book: true, agenda: true }, trucks: [] } as unknown as Access;
const mechanic = { id: 'saleh', owner: false, roles: ['mechanic'], rights: { hours: true }, trucks: ['t1'] } as unknown as Access;
const job = (o: Partial<Job> = {}) => ({ id: 'j1', number: 7, day: '2026-11-20', block: 'am', status: 'booked', truck_id: 't1', stop_order: 1, duration_min: 60, customer_id: null, eta_min: 600, ...o }) as unknown as Job;
const keys = (j: Job, o?: Parameters<typeof jobActions>[1]) => jobActions(j, o).actions.map((a) => a.key);

afterEach(() => { access.value = null; movesWaiting.value = new Set(); location.hash = ''; });

describe('who may move an appointment (the agenda’s own rule)', () => {
  it('the owner and the office with « Réserver », on a booked appointment', () => {
    access.value = owner;
    expect(mayMove(job())).toBe(true);
    access.value = office;
    expect(mayMove(job())).toBe(true);
  });
  it('never a mechanic without « Réserver », even on his own truck', () => {
    access.value = mechanic;
    expect(mayMove(job())).toBe(false);
    expect(keys(job())).not.toContain('move');
  });
  it('never an appointment under way or done', () => {
    access.value = owner;
    for (const status of ['en_route', 'on_site', 'done', 'cancelled', 'no_show'] as const) {
      expect(mayMove(job({ status }))).toBe(false);
      expect(keys(job({ status }))).not.toContain('move');
    }
  });
  it('never while a move of it still waits on the phone', () => {
    access.value = owner;
    setWaiting('j1', true);
    expect(mayMove(job())).toBe(false);
    expect(keys(job())).not.toContain('move');
    setWaiting('j1', false);
    expect(mayMove(job())).toBe(true);
    expect(mayMove(null)).toBe(false);
  });
});

describe('« Déplacer » in the menu', () => {
  it('without onMove (the agenda): the appointment’s screen opens with its sheet, as before', () => {
    access.value = owner;
    const move = jobActions(job()).actions.find((a) => a.key === 'move')!;
    move.run();
    expect(location.hash).toBe('#/job/j1?do=move');
    expect(route.value.path).toBe('/job/j1');
  });
  it('with onMove (a list of stops): the sheet opens on the screen itself, nothing else is opened', () => {
    access.value = owner;
    location.hash = '#/map';
    const asked: string[] = [];
    const move = jobActions(job(), { onMove: (j) => asked.push(j.id) }).actions.find((a) => a.key === 'move')!;
    move.run();
    expect(asked).toEqual(['j1']);
    expect(location.hash).toBe('#/map');
  });
  it('the same shortcuts as the agenda’s, in the same order', () => {
    access.value = owner;
    expect(keys(job(), { onMove: () => undefined })).toEqual(keys(job()));
    expect(keys(job())[0]).toBe('open');
    expect(keys(job())).toContain('move');
  });
  it('menuProps: nothing for a stop this phone does not hold (the browser’s own menu stays)', () => {
    expect(menuProps(null)).toEqual({});
    access.value = owner;
    const p = menuProps(job()) as Record<string, unknown>;
    expect(typeof p.onContextMenu).toBe('function');
    expect(typeof p.onTouchStart).toBe('function');
    expect(typeof p.onClickCapture).toBe('function');
  });
});
