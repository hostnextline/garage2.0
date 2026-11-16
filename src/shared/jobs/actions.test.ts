/* What the steps send, and what they do when the server says no or the signal is weak. The server, the toasts, the
   position and the questions are pretended. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  jobStep: vi.fn(), shiftStart: vi.fn(() => Promise.resolve()), invoiceForJob: vi.fn(() => Promise.resolve({ queued: false })),
  enroute: vi.fn(), notify: vi.fn(), errorMessage: (e: unknown) => String((e as { message?: string })?.message || e)
}));
const sync = vi.hoisted(() => ({ refetch: vi.fn(() => Promise.resolve()), pull: vi.fn(() => Promise.resolve()), isNetworkError: () => false }));
const ui = vi.hoisted(() => ({ toast: vi.fn(), ask: vi.fn(() => Promise.resolve(true)), askText: vi.fn(() => Promise.resolve('Interac ce soir')), run: async (fn: () => unknown) => { try { return await fn(); } catch { return undefined; } }, whenHistorySettled: (fn: () => void) => fn() }));
const where = vi.hoisted(() => ({ quickPosition: vi.fn(() => Promise.resolve({ lat: 45.5, lng: -73.6 })) }));
const parts = vi.hoisted(() => ({ confirmParts: vi.fn() }));
vi.mock('../../data/api', () => api);
vi.mock('../../data/sync', async (orig) => ({ ...(await orig<typeof import('../../data/sync')>()), ...sync }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), ...ui }));
vi.mock('../../services/position', () => where);
vi.mock('./PartsSheet', () => parts);
vi.mock('./CarCheckSheet', () => ({ askCar: vi.fn(() => Promise.resolve(null)), saveCar: vi.fn() }));

import { upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import type { Job, Access } from '../../data/types';
import { doFinish, doLeave, doArrive, startInvoice, drives } from './actions';
import { doReturnEnd } from './returnTrip';

const JOB = (o: Partial<Job> = {}) => ({ id: 'j1', number: 7, status: 'on_site', day: '2026-11-15', block: 'am', truck_id: 't1', customer_id: 'c1', vehicle_id: null, pay_later: false, pay_later_reason: null, waiver_signed_at: 'x', coffre_id: null, odometer_km: 1, ...o } as unknown as Job);
const owner = { id: 'owner', roles: [], owner: true, rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'saleh', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
const refusal = (hint: string) => Object.assign(new Error(hint), { hint });

beforeEach(() => {
  clearAll();
  for (const f of [...Object.values(api), ...Object.values(sync), ...Object.values(ui), where.quickPosition, parts.confirmParts]) if (typeof f === 'function' && 'mockClear' in f) (f as ReturnType<typeof vi.fn>).mockClear();
  api.jobStep.mockResolvedValue({ queued: false, data: {} });
  api.enroute.mockResolvedValue({ ok: true, sms: 'sent', eta_at: null });
  api.notify.mockResolvedValue({ ok: true, status: 'sent' });
  upsertLocal('customers', [{ id: 'c1', first_name: 'Julie', phone: '5145551234', sms_ok: true }]);
  upsertLocal('trucks', [{ id: 't1', name: 'Camion', driver_id: 'saleh', active: true, sort: 0 }]);
});

describe('« Terminer la job »', () => {
  it('« paiera plus tard » already granted (the job came back from done): sent again with its reason, no refusal (jobs-a-05)', async () => {
    access.value = owner;
    upsertLocal('invoices', [{ id: 'inv1', job_id: 'j1', status: 'issued', total_cents: 1000, paid_cents: 0, lines: [] }]);
    await doFinish(JOB({ pay_later: true, pay_later_reason: 'Interac' }), { payLater: true });
    expect(api.jobStep).toHaveBeenCalledWith('j1', 'finish', { pay_later: true, reason: 'Interac' });
    expect(ui.askText).not.toHaveBeenCalled();
  });
  it('no planned part known on this phone: no list is sent, the server takes the parts it plans (jobs-b-05)', async () => {
    access.value = mechanic;
    await doFinish(JOB(), { payLater: false });
    expect(parts.confirmParts).not.toHaveBeenCalled();
    expect(api.jobStep).toHaveBeenCalledWith('j1', 'finish', {});
  });
  it('planned parts: the confirmed list goes with the step; stepping back sends nothing', async () => {
    access.value = mechanic;
    upsertLocal('inventory_items', [{ id: 'oil', name: 'Huile', unit: 'L', qty: 20 }]);
    upsertLocal('job_items', [{ id: 'i1', job_id: 'j1', item_id: 'oil', service_id: null, qty: 4.5, status: 'planned', sort: 1, description: 'Huile' }]);
    parts.confirmParts.mockResolvedValueOnce([{ item_id: 'oil', qty: 5 }]);
    await doFinish(JOB(), { payLater: false });
    expect(api.jobStep).toHaveBeenCalledWith('j1', 'finish', { parts: [{ item_id: 'oil', qty: 5 }] });
    parts.confirmParts.mockResolvedValueOnce(null);
    api.jobStep.mockClear();
    expect(await doFinish(JOB(), { payLater: false })).toBe(false);
    expect(api.jobStep).not.toHaveBeenCalled();
  });
});

describe('a step refused because the screen was stale brings the job back from the server (jobs-a-13)', () => {
  it('« Je suis arrivé » refused: the reason is said and the job is read again', async () => {
    access.value = owner;
    api.jobStep.mockRejectedValueOnce(refusal('bad_step'));
    await doArrive(JOB({ status: 'en_route' }));
    expect(sync.refetch).toHaveBeenCalledWith('jobs', 'j1');
    expect(ui.toast).toHaveBeenCalledWith('bad_step', { kind: 'bad' });
  });
});

describe('« Je pars »', () => {
  it('the owner pressing from home: no position from his phone, the server takes the driver’s (jobs-a-07)', async () => {
    access.value = owner;
    await doLeave(JOB({ status: 'booked' }), { mine: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(where.quickPosition).not.toHaveBeenCalled();
    expect(api.enroute).toHaveBeenCalledWith('start', 'j1', { pos: undefined, notify: true, resend: undefined });
    expect(api.shiftStart).not.toHaveBeenCalled();
  });
  it('the driver: his position, and his day starts beside the step, never before it (jobs-a-08, x-errors-13)', async () => {
    access.value = mechanic;
    let started = false;
    api.shiftStart.mockImplementationOnce(() => new Promise(() => { started = true; }));   // a dead signal: never answers
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    expect(started).toBe(true);
    expect(api.jobStep).toHaveBeenCalledWith('j1', 'leave');
    await new Promise((r) => setTimeout(r, 0));
    expect(api.enroute).toHaveBeenCalledWith('start', 'j1', { pos: { lat: 45.5, lng: -73.6 }, notify: true, resend: undefined });
  });
  it('« Routes partagées »: another mechanic (or an owner who is also a mechanic) pressing for a truck someone drives: no position from his phone, no day started for him (jobs-r4)', async () => {
    // every truck is his (my_truck_ids with shared routes), but Saleh drives t1
    access.value = { id: 'amine', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1', 't2'] } as unknown as Access;
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(where.quickPosition).not.toHaveBeenCalled();
    expect(api.shiftStart).not.toHaveBeenCalled();
    expect(api.enroute).toHaveBeenCalledWith('start', 'j1', { pos: undefined, notify: true, resend: undefined });
    access.value = { id: 'owner', roles: ['mechanic'], owner: true, rights: {}, trucks: ['t1'] } as unknown as Access;
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(where.quickPosition).not.toHaveBeenCalled();
    expect(api.shiftStart).not.toHaveBeenCalled();
  });
  it('a truck with no driver: the mechanic of that truck pressing is the one driving', async () => {
    upsertLocal('trucks', [{ id: 't1', name: 'Camion', driver_id: null, active: true, sort: 0 }]);
    access.value = { id: 'amine', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
    expect(drives(JOB(), { mine: true })).toBe(true);
    expect(drives(JOB(), { mine: false })).toBe(false);
    access.value = owner;
    expect(drives(JOB(), { mine: false })).toBe(false);
  });
  it('a customer with no cell number: no « text to send by hand » sheet (jobs-a-17)', async () => {
    access.value = mechanic;
    api.enroute.mockResolvedValueOnce({ ok: true, sms: 'no_phone', message: 'x', link: 'y' });
    const { outcome } = await import('./texts');
    outcome.value = null;
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(outcome.value).toBeNull();
  });
});

describe('« Je suis arrivé »', () => {
  it('no priced work: no invoice text (the server would refuse it after making an empty draft) (jobs-a-10)', async () => {
    access.value = mechanic;
    await doArrive(JOB({ status: 'en_route' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.notify).not.toHaveBeenCalled();
    upsertLocal('job_items', [{ id: 'i1', job_id: 'j1', qty: 1, unit_cents: 8999, status: 'planned', sort: 1, description: 'Huile', kind: 'service', taxable: true }]);
    await doArrive(JOB({ status: 'en_route' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.notify).toHaveBeenCalledWith('arrived', 'j1', expect.anything());
  });
  it('the button is free once the step is kept: the text does not hold it (jobs-a-08)', async () => {
    access.value = mechanic;
    upsertLocal('job_items', [{ id: 'i1', job_id: 'j1', qty: 1, unit_cents: 8999, status: 'planned', sort: 1, description: 'Huile', kind: 'service', taxable: true }]);
    api.notify.mockImplementationOnce(() => new Promise(() => undefined));   // 40 s of a weak signal
    await doArrive(JOB({ status: 'en_route' }));   // resolves although the text never answers
    expect(api.jobStep).toHaveBeenCalledWith('j1', 'arrive');
  });
});

describe('« Faire la facture »', () => {
  it('never rewrites a draft someone edited meanwhile: the first call does not refresh (x-sync-13)', async () => {
    access.value = mechanic;
    await startInvoice(JOB());
    expect(api.invoiceForJob).toHaveBeenCalledWith('j1', false);
  });
});

describe('« Je suis arrivé » at the start', () => {
  it('a refusal is said, not « bien arrivé » (x-errors-31)', async () => {
    access.value = mechanic;
    api.enroute.mockResolvedValueOnce({ ok: false, error: 'Session expirée' });
    await doReturnEnd();
    expect(ui.toast).not.toHaveBeenCalledWith(expect.stringMatching(/arriv/i), { kind: 'ok' });
    expect(ui.toast.mock.calls[0][1]).toEqual({ kind: 'bad' });
  });
});
