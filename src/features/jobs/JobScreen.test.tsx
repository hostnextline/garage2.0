/* The job sheet: « introuvable » only once the server answered (jobs-a-24); the signature survives the back gesture
   (jobs-a-11); a line taken off before the visit can be put back (jobs-b-12). The server is pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const sync = vi.hoisted(() => ({ answer: null as null | (() => void), refetch: vi.fn() }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), refetch: sync.refetch }));
vi.mock('../../services/position', () => ({ startPositionSharing: () => undefined, quickPosition: () => Promise.resolve(undefined) }));
const api = vi.hoisted(() => ({ removeItem: vi.fn(() => Promise.resolve()), updateItem: vi.fn(() => Promise.resolve()), moveJob: vi.fn(() => Promise.resolve({ queued: false, data: { changed: true } })) }));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));
// the pad as a button that « signs » (the canvas has no drawing in jsdom)
vi.mock('../../shared/sign/SignaturePad', () => ({
  SignaturePad: (p: { strokes: unknown[]; onStrokes: (s: unknown[]) => void; 'data-testid'?: string }) =>
    <button type="button" data-testid={p['data-testid']} data-n={p.strokes.length} onClick={() => p.onStrokes([...p.strokes, [{ x: 0, y: 0 }, { x: 90, y: 40 }]])}>pad</button>
}));

import { net } from '../../data/sync';
import { upsertLocal, getRow, clearAll } from '../../data/store';
import { toasts } from '../../ui/toast';
import { t } from '../../lib/i18n';
import type { Job, JobItem } from '../../data/types';
import JobScreen from './JobScreen';
import { WaiverSheet } from './WaiverSheet';
import { takeOff } from './work/WorkPanel';
import { TruckSheet } from './TruckSheet';
import { placeMissing } from './HeadPanel';

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
beforeEach(() => { clearAll(); net.value = { ...net.value, ready: true }; sync.refetch.mockReset(); toasts.value = []; });
afterEach(() => { act(() => render(null, box)); });

describe('a job not on this phone yet', () => {
  it('is « being opened » until the server answered, then « introuvable » (before: « introuvable » during the request)', async () => {
    let answer: () => void = () => undefined;
    sync.refetch.mockImplementation(() => new Promise<void>((r) => { answer = r; }));
    await act(() => render(<JobScreen params={{ id: 'j404' }} query={new URLSearchParams()} />, box));
    await flush();
    expect(sync.refetch).toHaveBeenCalledWith('jobs', 'j404');
    expect(box.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(box.textContent).not.toContain(t('jobs.notFound'));
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 0)); });
    expect(box.textContent).toContain(t('jobs.notFound'));
  });
});

describe('the signature of the authorization', () => {
  const job = { id: 'j1', customer_id: null, status: 'on_site' } as unknown as Job;
  const Sheet = (p: { open: boolean }) => <WaiverSheet job={job} open={p.open} onClose={() => undefined} />;
  it('closed by the back gesture, it is still there when the sheet opens again; « Annuler » starts over', async () => {
    await act(() => render(<Sheet open />, box));
    await act(async () => { q('waiver-pad')!.click(); });
    expect(q('waiver-pad')!.dataset.n).toBe('1');
    // the phone's back gesture closes the sheet (the kit's Sheet closes on the history step)
    await act(() => render(<Sheet open={false} />, box));
    await act(() => render(<Sheet open />, box));
    expect(q('waiver-pad')!.dataset.n).toBe('1');
  });
});

describe('a line taken off before the visit', () => {
  it('leaves the job, and « Annuler » in the toast puts it back with its price (before: gone for good in one tap)', async () => {
    const line = { id: 'i1', job_id: 'j1', status: 'planned', description: 'Essuie-glaces', qty: 2, unit_cents: 4000, sort: 1, note: 'côté conducteur' } as unknown as JobItem;
    upsertLocal('job_items', [line]);
    await takeOff({ id: 'j1', status: 'booked' } as Job, line);
    expect(api.removeItem).toHaveBeenCalledWith('i1');
    const undo = toasts.value.find((x) => x.action)?.action;
    expect(undo).toBeTruthy();
    upsertLocal('job_items', [{ ...line, deleted_at: 'x' }]);
    await act(async () => { await undo!.run(); });
    expect(getRow<JobItem>('job_items', 'i1')?.unit_cents).toBe(4000);
    expect(api.updateItem).toHaveBeenCalledWith('i1', { deleted_at: null });
  });
  it('on site it stays on the job as « Pas fait »', async () => {
    const line = { id: 'i2', job_id: 'j1', status: 'done', description: 'Huile', qty: 1, unit_cents: 1, sort: 1 } as unknown as JobItem;
    await takeOff({ id: 'j1', status: 'on_site' } as Job, line);
    expect(api.updateItem).toHaveBeenCalledWith('i2', { status: 'removed' });
  });
});

describe('« Changer de camion » keeps what the customer was told (x-dualmode-23)', () => {
  it('a job booked by window moves to another truck without sending the window again (its end and « flexible » stay)', async () => {
    const job = { id: 'j1', status: 'booked', day: '2026-11-20', block: 'day', win_start: 840, win_end: null, win_flex: true, truck_id: 't1', truck_pinned: true, duration_min: 60 } as unknown as Job;
    await act(() => render(<TruckSheet job={job} open onClose={() => undefined} />, box));
    await act(async () => { q('truck-auto')!.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(api.moveJob).toHaveBeenCalledTimes(1);
    expect(api.moveJob.mock.calls[0]).toEqual(['j1', '2026-11-20', 'day', null]);
  });
});

describe('« pas de position » under the address (jobs-a-12)', () => {
  it('the appointment’s own address is judged by its own position, not the customer’s home', () => {
    expect(placeMissing({ address: '500 rue du Chalet', lat: null }, { address: '1 rue Maison', lat: 45.5 })).toBe(true);
    expect(placeMissing({ address: '500 rue du Chalet', lat: 45.6 }, { address: '1 rue Maison', lat: null })).toBe(false);
    expect(placeMissing({ address: null, lat: null }, { address: '1 rue Maison', lat: 45.5 })).toBe(false);
    expect(placeMissing({ address: null, lat: null }, { address: '1 rue Maison', lat: null })).toBe(true);
    expect(placeMissing({ address: '', lat: null }, undefined)).toBe(false);
  });
});
