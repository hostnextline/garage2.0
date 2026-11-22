/* What the steps send, and what they do when the server says no or the signal is weak. The server, the toasts, the
   position and the questions are pretended. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const api = vi.hoisted(() => ({
  jobStep: vi.fn(), shiftStart: vi.fn(() => Promise.resolve()), invoiceForJob: vi.fn(() => Promise.resolve({ queued: false })),
  enroute: vi.fn(), notify: vi.fn(), errorMessage: (e: unknown) => String((e as { message?: string })?.message || e)
}));
const sync = vi.hoisted(() => ({ refetch: vi.fn(() => Promise.resolve()), pull: vi.fn(() => Promise.resolve()), isNetworkError: (e: unknown) => (e as Error | null)?.message === 'Failed to fetch' }));
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
import { doReturnEnd, doReturn } from './returnTrip';
import { sendText } from './texts';

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
  it('« Routes partagées »: a mechanic leaving with a truck another one drives is the one who leaves: his position, his day starts, and he names himself (R30; jobs-r2-2)', async () => {
    // every truck is his (my_truck_ids with shared routes), Saleh is t1's named driver, Amine takes it today
    access.value = { id: 'amine', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1', 't2'] } as unknown as Access;
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(where.quickPosition).toHaveBeenCalledTimes(1);
    expect(api.shiftStart).toHaveBeenCalledTimes(1);
    // the server gives the trip to the truck's driver while the presser's day is not started (fn-terrain 2709e2d), and the
    // start of his day goes beside « Je pars »: driver_id = himself, so the trip is Amine's whichever came first
    expect(api.enroute).toHaveBeenCalledWith('start', 'j1', { pos: { lat: 45.5, lng: -73.6 }, driver_id: 'amine', notify: true, resend: undefined });
  });
  it('the truck’s own driver, or a truck with no driver: no driver_id (the server already gives him the trip)', async () => {
    access.value = mechanic;
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    await new Promise((r) => setTimeout(r, 0));
    expect((api.enroute.mock.calls[0][2] as Record<string, unknown>).driver_id).toBeUndefined();
    upsertLocal('trucks', [{ id: 't1', name: 'Camion', driver_id: null, active: true, sort: 0 }]);
    access.value = { id: 'amine', roles: ['mechanic'], owner: false, rights: {}, trucks: ['t1'] } as unknown as Access;
    api.enroute.mockClear();
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    await new Promise((r) => setTimeout(r, 0));
    expect((api.enroute.mock.calls[0][2] as Record<string, unknown>).driver_id).toBeUndefined();
  });
  it('an owner (or the office) who is also a mechanic pressing for a truck another drives, his day not started: maybe from home, no position from his phone, no day started for him (jobs-r4)', async () => {
    access.value = { id: 'owner', roles: ['mechanic'], owner: true, rights: {}, trucks: ['t1'] } as unknown as Access;
    await doLeave(JOB({ status: 'booked' }), { mine: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(where.quickPosition).not.toHaveBeenCalled();
    expect(api.shiftStart).not.toHaveBeenCalled();
    expect(api.enroute).toHaveBeenCalledWith('start', 'j1', { pos: undefined, notify: true, resend: undefined });
    access.value = { id: 'nadia', roles: ['mechanic'], owner: false, rights: { book: true }, trucks: ['t1'] } as unknown as Access;
    expect(drives(JOB(), { mine: true })).toBe(false);
    // his day is started: he is out in a vehicle (the server gives him the trip too)
    upsertLocal('shifts', [{ id: 's1', staff_id: 'owner', started_at: '2026-11-15T12:00:00Z', ended_at: null }]);
    access.value = { id: 'owner', roles: ['mechanic'], owner: true, rights: {}, trucks: ['t1'] } as unknown as Access;
    expect(drives(JOB(), { mine: true })).toBe(true);
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

describe('one operation id per text and per « Je pars vers la Centrale », kept until the server answered (R27, R28)', () => {
  const opOf = (call: unknown[]) => (call[2] as { op?: string }).op;
  it('a text the server is still busy with, tapped again: the same id (one text); answered, the next one is a new send', async () => {
    access.value = mechanic;
    api.notify.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'busy' }));
    await sendText('moved', JOB());
    await sendText('moved', JOB());
    await sendText('moved', JOB());
    const [a, b, c] = api.notify.mock.calls.map(opOf);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toBe(a);
    // the second one was answered: « Renvoyer » now sends again
    expect(c).not.toBe(a);
    // another text, or another job: its own id
    await sendText('booking', JOB());
    expect(opOf(api.notify.mock.calls[3])).not.toBe(c);
  });
  it('a refusal is an answer: the next try is a new send', async () => {
    access.value = mechanic;
    api.notify.mockRejectedValueOnce(refusal('nothing'));
    await sendText('extras', JOB());
    await sendText('extras', JOB());
    const [a, b] = api.notify.mock.calls.map(opOf);
    expect(b).not.toBe(a);
  });
  it('« Je pars vers la Centrale » goes with its id; tried again while the server is busy with it: the same id', async () => {
    access.value = mechanic;
    api.enroute.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'busy' }));
    await doReturn();
    await doReturn();
    await doReturn();
    const ops = api.enroute.mock.calls.map((c) => (c[2] as { op?: string }).op);
    expect(api.enroute.mock.calls[0].slice(0, 2)).toEqual(['return', null]);
    expect(ops[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ops[1]).toBe(ops[0]);
    expect(ops[2]).not.toBe(ops[0]);
  });
});

describe('a kept id is the same send only while it tells the same thing, and only for its retry (jobs-r2-1)', () => {
  const opOf = (call: unknown[]) => (call[2] as { op?: string }).op;
  const lost = () => new Error('Failed to fetch');
  afterEach(() => { vi.useRealTimers(); });
  it('the answer of « moved » lost, then the job moved to another day: a new id (Thursday is texted, not Tuesday’s answer)', async () => {
    access.value = mechanic;
    api.notify.mockRejectedValueOnce(lost());
    await sendText('moved', JOB({ id: 'm1', status: 'booked', day: '2026-11-17' }));
    await sendText('moved', JOB({ id: 'm1', status: 'booked', day: '2026-11-19' }));
    const [tue, thu] = api.notify.mock.calls.map(opOf);
    expect(thu).not.toBe(tue);
  });
  it('« Déplacer » passes the job as its sheet showed it: what is texted is read from the job as it is now', async () => {
    access.value = mechanic;
    // moved Monday → Tuesday: the row says Tuesday, the sheet's job still Monday; the answer is lost
    upsertLocal('jobs', [JOB({ id: 'm2', status: 'booked', day: '2026-11-17' })]);
    api.notify.mockRejectedValueOnce(lost());
    await sendText('moved', JOB({ id: 'm2', status: 'booked', day: '2026-11-16' }));
    // then Tuesday → Thursday: the sheet showed Tuesday, the row says Thursday
    upsertLocal('jobs', [JOB({ id: 'm2', status: 'booked', day: '2026-11-19' })]);
    await sendText('moved', JOB({ id: 'm2', status: 'booked', day: '2026-11-17' }));
    const [tue, thu] = api.notify.mock.calls.map(opOf);
    expect(thu).not.toBe(tue);
  });
  it('the same text tried again after a lost answer keeps its id (one text, R27); « extras » with other work proposed is a new one', async () => {
    access.value = mechanic;
    upsertLocal('job_items', [{ id: 'x1', job_id: 'm3', qty: 1, unit_cents: 4500, status: 'proposed', sort: 1, description: 'Essuie-glaces', kind: 'service', taxable: true }]);
    api.notify.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    await sendText('extras', JOB({ id: 'm3' }));
    await sendText('extras', JOB({ id: 'm3' }));
    upsertLocal('job_items', [{ id: 'x2', job_id: 'm3', qty: 1, unit_cents: 12000, status: 'proposed', sort: 2, description: 'Freins', kind: 'service', taxable: true }]);
    await sendText('extras', JOB({ id: 'm3' }));
    const [a, b, c] = api.notify.mock.calls.map(opOf);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
  it('« Renvoyer » whose answer was lost: tried again within minutes, the same id; an hour later, a new send', async () => {
    access.value = mechanic;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'));
    api.notify.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    await sendText('booking', JOB({ id: 'm4', status: 'booked' }), { resend: true });
    vi.setSystemTime(new Date('2026-11-16T15:02:00Z'));
    await sendText('booking', JOB({ id: 'm4', status: 'booked' }), { resend: true });
    vi.setSystemTime(new Date('2026-11-16T16:05:00Z'));
    await sendText('booking', JOB({ id: 'm4', status: 'booked' }), { resend: true });
    const [a, b, c] = api.notify.mock.calls.map(opOf);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
  it('« Je pars vers la Centrale » after a lost answer: the next day is a new trip, not yesterday’s « already »', async () => {
    access.value = mechanic;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T21:00:00Z'));   // 16 h in Montréal
    api.enroute.mockRejectedValueOnce(lost()).mockRejectedValueOnce(lost());
    await doReturn();
    vi.setSystemTime(new Date('2026-11-16T21:02:00Z'));
    await doReturn();                                       // the retry of the lost answer: the same id
    vi.setSystemTime(new Date('2026-11-17T21:00:00Z'));   // the next day
    await doReturn();
    const [a, b, c] = api.enroute.mock.calls.map(opOf);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
  it('the day is Montréal’s: a lost answer at 23 h 58, tried again at 0 h 01, is the next day’s way back', async () => {
    access.value = mechanic;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T04:58:00Z'));   // 23 h 58 in Montréal (UTC-5)
    api.enroute.mockRejectedValueOnce(lost());
    await doReturn();
    vi.setSystemTime(new Date('2026-11-17T05:01:00Z'));   // 0 h 01
    await doReturn();
    const [a, b] = api.enroute.mock.calls.map(opOf);
    expect(b).not.toBe(a);
  });
  it('« Je suis arrivé » at the start ends the kept way back: the next « Je pars vers la Centrale » is a new trip', async () => {
    access.value = mechanic;
    api.enroute.mockRejectedValueOnce(lost());
    await doReturn();
    await doReturnEnd();
    await doReturn();
    const ops = api.enroute.mock.calls.filter((c) => c[0] === 'return').map(opOf);
    expect(ops[1]).not.toBe(ops[0]);
  });
});
