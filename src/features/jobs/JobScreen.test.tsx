/* The job sheet: « introuvable » only once the server answered (jobs-a-24); the signature survives the back gesture
   (jobs-a-11); a line taken off before the visit can be put back (jobs-b-12). The server is pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const sync = vi.hoisted(() => ({ answer: null as null | (() => void), refetch: vi.fn() }));
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), refetch: sync.refetch }));
const where = vi.hoisted(() => ({ quickPosition: vi.fn((): Promise<{ lat: number; lng: number } | undefined> => Promise.resolve(undefined)) }));
vi.mock('../../services/position', () => ({ startPositionSharing: () => undefined, quickPosition: where.quickPosition }));
const api = vi.hoisted(() => ({
  removeItem: vi.fn(() => Promise.resolve()), updateItem: vi.fn(() => Promise.resolve()),
  moveJob: vi.fn((..._a: unknown[]) => Promise.resolve({ queued: false, data: { changed: true } as Record<string, unknown> })),
  notify: vi.fn((..._a: unknown[]) => Promise.resolve({ status: 'sent', link: null, message: null, phone: null, error: null })),
  enroute: vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true, sms: 'sent', link: null, message: null, phone: null, eta_at: null }))
}));
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));
const coffre = vi.hoisted(() => ({ openCoffre: vi.fn() }));
vi.mock('../../shared/invoices/CoffreHost', async (orig) => ({ ...(await orig<typeof import('../../shared/invoices/CoffreHost')>()), ...coffre }));
// the pad as a button that « signs » (the canvas has no drawing in jsdom)
vi.mock('../../shared/sign/SignaturePad', () => ({
  SignaturePad: (p: { strokes: unknown[]; onStrokes: (s: unknown[]) => void; 'data-testid'?: string }) =>
    <button type="button" data-testid={p['data-testid']} data-n={p.strokes.length} onClick={() => p.onStrokes([...p.strokes, [{ x: 0, y: 0 }, { x: 90, y: 40 }]])}>pad</button>
}));

import { net } from '../../data/sync';
import { upsertLocal, getRow, clearAll } from '../../data/store';
import { toasts } from '../../ui/toast';
import { t } from '../../lib/i18n';
import type { Job, JobItem, Access } from '../../data/types';
import { access } from '../../data/auth';
import JobScreen from './JobScreen';
import { WaiverSheet } from './WaiverSheet';
import { takeOff } from './work/WorkPanel';
import { TruckSheet } from './TruckSheet';
import { placeMissing } from './HeadPanel';
import { ItemSheet } from './work/ItemSheet';
import { jobRights } from '../../domain/jobs/rights';
import { clearTextAsks, TEXT_ASK_DEAD_MS } from '../../shared/jobs/textAsk';

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
  it('« Texter … ? » only when the server says what the customer was told changed (R84); the text only on « Envoyer le texto »', async () => {
    upsertLocal('settings', [{ id: '1', messages: { on: { moved: true }, fr: {}, en: {} } } as never]);
    upsertLocal('customers', [{ id: 'c1', first_name: 'Julie', phone: '5145550141', sms_ok: true } as never]);
    const job = { id: 'j1', status: 'booked', day: '2026-11-20', block: 'pm', customer_id: 'c1', truck_id: 't1', truck_pinned: true, duration_min: 60 } as unknown as Job;
    upsertLocal('jobs', [job as never]);
    // (the question waits for the closed sheet's step back in the history: up to 700 ms when the browser never answers it)
    const pick = async () => {
      await act(() => render(<TruckSheet job={job} open onClose={() => undefined} />, box));
      await act(async () => { q('truck-auto')!.click(); await new Promise((r) => setTimeout(r, 900)); });
      await act(() => render(null, box));
    };
    // another truck, the same moment: tell false → no text
    api.moveJob.mockImplementationOnce(() => Promise.resolve({ queued: false, data: { ok: true, changed: false, tell: false, truck_changed: true } }));
    await pick();
    expect(q('text-ask')).toBeNull();
    expect(api.notify).not.toHaveBeenCalled();
    // the server cut a new window (a job of the other mode): tell true → the question, and nothing goes by itself
    api.moveJob.mockImplementationOnce(() => Promise.resolve({ queued: false, data: { ok: true, changed: false, tell: true, window_changed: true } }));
    await pick();
    expect(q('text-ask')).not.toBeNull();
    expect(api.notify).not.toHaveBeenCalled();
    // « Envoyer le texto »: the very send of before
    await act(async () => { await new Promise((r) => setTimeout(r, TEXT_ASK_DEAD_MS + 40)); });
    await act(async () => { q('text-ask-send')!.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(api.notify).toHaveBeenCalledTimes(1);
    expect(api.notify.mock.calls[0]).toEqual(['moved', 'j1', { op: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    await act(async () => { clearTextAsks(); });
  });
});

describe('« Payé par le Coffre » from the job’s menu (R49)', () => {
  it('opens the one Coffre sheet of the app (the frame’s host), not a second one of the job sheet', async () => {
    access.value = { id: 'owner', roles: [], owner: true, rights: {}, trucks: [] } as unknown as Access;
    upsertLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '5145551234' }]);
    upsertLocal('jobs', [{ id: 'j1', number: 7, status: 'booked', day: '2030-01-15', block: 'am', truck_id: null, customer_id: 'c1', vehicle_id: null, waiver_signed_at: null, coffre_id: null, duration_min: 60 }]);
    await act(() => render(<JobScreen params={{ id: 'j1' }} query={new URLSearchParams()} />, box));
    await act(async () => { q('job-menu')!.click(); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { q('menu-coffre')!.click(); await new Promise((r) => setTimeout(r, 900)); });
    expect(coffre.openCoffre).toHaveBeenCalledWith('j1');
    expect(q('coffre-sheet')).toBeNull();
  });
});

describe('« Renvoyer le texto « en route » » from the job’s menu: the one who leaves, as « Je pars » says it (jobs-r2-2)', () => {
  const menuTracking = async () => {
    await act(() => render(<JobScreen params={{ id: 'j1' }} query={new URLSearchParams()} />, box));
    await act(async () => { q('job-menu')!.click(); await new Promise((r) => setTimeout(r, 0)); });
    const row = [...document.querySelectorAll('[data-testid="job-menu-sheet"] button')].find((b) => b.textContent?.includes(t('jobs.menu.sendTracking'))) as HTMLElement;
    await act(async () => { row.click(); await new Promise((r) => setTimeout(r, 900)); });
  };
  beforeEach(() => {
    api.enroute.mockClear();
    where.quickPosition.mockReset();
    where.quickPosition.mockImplementation(() => Promise.resolve({ lat: 45.5, lng: -73.6 }));
    upsertLocal('customers', [{ id: 'c1', first_name: 'Julie', last_name: 'Roy', phone: '5145551234' }]);
    upsertLocal('trucks', [{ id: 't1', name: 'Camion', driver_id: 'saleh', active: true, sort: 0 }]);
    upsertLocal('jobs', [{ id: 'j1', number: 7, status: 'en_route', day: '2030-01-15', block: 'am', truck_id: 't1', customer_id: 'c1', vehicle_id: null, waiver_signed_at: null, coffre_id: null, duration_min: 60 }]);
  });
  it('an owner who is also a mechanic, at the office for Saleh’s truck: no position from his phone (before: his office’s)', async () => {
    access.value = { id: 'owner', roles: ['mechanic'], owner: true, rights: {}, trucks: ['t1'] } as unknown as Access;
    await menuTracking();
    expect(where.quickPosition).not.toHaveBeenCalled();
    expect(api.enroute).toHaveBeenCalledWith('start', 'j1', { pos: undefined, notify: true, resend: true });
  });
  it('« Routes partagées »: the mechanic who took Saleh’s truck sends his position and names himself', async () => {
    access.value = { id: 'amine', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
    await menuTracking();
    expect(api.enroute).toHaveBeenCalledWith('start', 'j1', { pos: { lat: 45.5, lng: -73.6 }, driver_id: 'amine', notify: true, resend: true });
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

describe('a billed line whose invoice may not be opened again here (invoices 1, S53)', () => {
  const job = { id: 'j1', status: 'on_site', day: '2030-01-15', block: 'am', truck_id: 't1', created_by: null } as unknown as Job;
  const line = { id: 'i1', job_id: 'j1', status: 'done', description: 'Huile', qty: 1, unit_cents: 11498, sort: 1 } as unknown as JobItem;
  const inv = (paid: number) => ({ id: 'v1', job_id: 'j1', number: 12, status: 'paid', total_cents: 11498, paid_cents: paid,
    lines: [{ item_id: 'i1', description: 'Huile', qty: 1, unit_cents: 11498 }] });
  const open = async (j: Job = job) => {
    access.value = { id: 'amine', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
    upsertLocal('jobs', [j]);
    upsertLocal('job_items', [line]);
    await act(() => render(<ItemSheet job={j} item={line} rights={jobRights(j)} onClose={() => undefined} onAnswer={() => undefined} />, box));
  };
  it('paid exactly: « rouvre-la : » and the « Modifier la facture » button', async () => {
    upsertLocal('invoices', [inv(11498) as never]);
    await open();
    expect(q('item-locked')!.textContent).toContain(t('invoices.reopen.itemPaid'));
    expect(q('invoice-reopen')).not.toBeNull();
  });
  it('paid more than its total: « rouvre-la : » and the button too (owner, 2026-11-20: finished again « payée », the office gives the rest back)', async () => {
    upsertLocal('invoices', [inv(20000) as never]);
    await open();
    expect(q('invoice-reopen')).not.toBeNull();
    expect(q('item-locked')!.textContent).toContain(t('invoices.reopen.itemPaid'));
    expect(q('item-locked')!.textContent).not.toContain(t('invoices.reopen.itemLocked'));
  });
  it('another truck’s job, for a mechanic without « Réserver »: « demande au bureau », no button', async () => {
    upsertLocal('invoices', [inv(11498) as never]);
    await open({ ...job, truck_id: 't2' } as Job);
    expect(q('invoice-reopen')).toBeNull();
    expect(q('item-locked')!.textContent).toContain(t('invoices.reopen.itemLocked'));
    expect(q('item-locked')!.textContent).not.toContain(t('invoices.reopen.itemPaid'));
  });
});
