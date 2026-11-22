/* « Réserver à l'heure choisie » (Part 30, K1–K3) through the booking screen drawn for real (the rows on the device, the
   server pretended; the calendar replaced by a button that picks a time, as BookScreen.test.tsx does): a time of the
   calendar is booked AT that minute through the preview; no room → the warning, « Réserver quand même à 14 h », then the
   new map of that day over its agenda; the booking text at once, its window the one of the minute; no signal and two
   cars: booked as before (the window). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { BlockPickerProps } from '../../domain/moment/choice';
import type { ServicePickerProps } from '../../shared/moment/ServicePicker';

const api = vi.hoisted(() => ({
  bookJob: vi.fn(), walkIn: vi.fn(), suggestBlocks: vi.fn(), saveCustomer: vi.fn(), saveVehicle: vi.fn(),
  errorMessage: (e: unknown) => (e as Error).message
}));
const pv = vi.hoisted(() => ({ bookPreview: vi.fn() }));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
const texts = vi.hoisted(() => ({ notifyCustomer: vi.fn(), wantsText: vi.fn() }));
const map = vi.hoisted(() => ({ openBookedMapOn: vi.fn() }));
const places = vi.hoisted(() => ({ withPosition: vi.fn() }));
vi.mock('../../shared/places/withPosition', () => places);
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));
vi.mock('../../data/bookAt', async (orig) => ({ ...(await orig<typeof import('../../data/bookAt')>()), ...pv }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), ask: ui.ask, toast: ui.toast }));
vi.mock('../../platform/router', async (orig) => ({ ...(await orig<typeof import('../../platform/router')>()), navigate: nav.navigate }));
vi.mock('../../shared/moment/notify', () => texts);
vi.mock('../../shared/moment/BookedMap', () => map);
vi.mock('../../shared/jobs/CarFirst', () => ({ OilHint: () => null }));
vi.mock('../../shared/moment/BlockPicker', () => ({
  BlockPicker: (p: BlockPickerProps) => (
    <>
      {/* a quarter hour of the calendar: 14 h, told 13 h – 17 h */}
      <button type="button" data-testid="stub-time" data-exact={String(!!p.exactBook)} onClick={() => p.onPick({ day: DAY, block: 'day', win_start: 780, win_end: 1020, eta: 840, truck: 'T1' })}>t</button>
      <button type="button" data-testid="stub-seen" onClick={() => p.onFar?.(null, { day: DAY, block: 'day', at: Date.now() })}>seen</button>
    </>
  )
}));
vi.mock('../../shared/moment/ServicePicker', () => ({
  ServicePicker: (p: ServicePickerProps) => (
    <div data-testid="stub-services">
      <button type="button" data-testid="stub-add" onClick={() => p.onValue([...p.value, { kind: 'service', service_id: 's-oil', description: 'Huile', qty: 1, unit_cents: 8999, taxable: true, duration_min: 45 }])}>+</button>
    </div>
  )
}));

import { upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { net } from '../../data/sync';
import { bookAtAnswer } from '../../data/bookAt';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import BookScreen from './BookScreen';

const DAY = addDays(today(), 2);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const wait = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await wait(); };
const draw = async (query: string) => { await act(() => render(<BookScreen params={{}} query={new URLSearchParams(query)} />, box)); await wait(); };
const stop = (id: string, before: number, after: number, late = false, lateMin = 0) => ({ id, day: DAY, truck_id: 'T1', order_before: 1, order_after: 2, eta_before: before, eta_after: after,
  win_start: 540, win_end: 780, delay_min: Math.max(0, after - before), late, late_min: lateMin, measured: null });
const preview = (stops: ReturnType<typeof stop>[], extra: Record<string, unknown> = {}) => (job: { id: string }) => bookAtAnswer({ ok: true, preview: true, exact: true, at: 840, job_id: job.id,
  truck_id: 'T1', win_start: 780, win_end: 1020, forced: stops.some((s) => s.late), may_force: true, stops: [stop(job.id, 0, 840), ...stops], over_hours: 0, earliest: 840, earliest_keep: 900, ...extra });
const wasOnline = net.value;

beforeEach(() => {
  lang.value = 'fr';
  access.value = { id: 'me', full_name: 'Hassan', short_name: null, email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null,
    rights: { book: true, agenda: true, clients: true } as never, trucks: [] };
  upsertLocal('settings', [{ id: '1', booking: { windows_on: true }, taxes: { enabled: true, tps: 0.05, tvq: 0.09975 }, messages: { on: { booking: true } } }], { force: true });
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }], { force: true });
  upsertLocal('customers', [{ id: 'c-1', first_name: 'Julie', last_name: 'Tremblay', phone: '514 555-0141', address: '1 rue A', lat: 45.5, lng: -73.6 },
    { id: 'c-2', first_name: 'Samir', last_name: 'Haddad', phone: '514 555-0177', address: '2 rue B', lat: 45.52, lng: -73.64 }], { force: true });
  upsertLocal('vehicles', [{ id: 'v-1', customer_id: 'c-1', year: 2019, make: 'Honda', model: 'Civic' },
    { id: 'v-2a', customer_id: 'c-2', year: 2016, make: 'Toyota', model: 'Corolla' }, { id: 'v-2b', customer_id: 'c-2', year: 2019, make: 'Toyota', model: 'Sienna' }], { force: true });
  upsertLocal('jobs', [{ id: 'D', customer_id: 'c-2', day: DAY, block: 'day', status: 'booked', truck_id: 'T1', eta_min: 700, win_start: 540, win_end: 780, duration_min: 60, number: 1001 }], { force: true });
  for (const f of [api.bookJob, api.walkIn, api.suggestBlocks, api.saveCustomer, api.saveVehicle, pv.bookPreview, ui.ask, ui.toast, nav.navigate, texts.notifyCustomer, texts.wantsText, map.openBookedMapOn, places.withPosition]) f.mockReset();
  places.withPosition.mockImplementation(async (p: unknown) => p);
  api.bookJob.mockImplementation(async (job: { id: string; arrive_at?: number }) => ({ queued: false, id: job.id, data: job.arrive_at != null ? { ok: true, exact: true, at: job.arrive_at, job_id: job.id, truck_id: 'T1', forced: false, stops: [], over_hours: 0, win_start: 780, win_end: 1020 } : {} }));
  api.suggestBlocks.mockResolvedValue([]);
  texts.wantsText.mockReturnValue(true);
  ui.ask.mockResolvedValue(true);
  net.value = { ...wasOnline, online: true };
});
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; net.value = wasOnline; });

describe('« Réserver » with a time of the calendar', () => {
  it('the picker is the booking one (exactBook); room: no question, booked AT 14 h, the appointment opens, the booking text at once with the window of 14 h', async () => {
    pv.bookPreview.mockImplementation(async (job: { id: string }) => preview([stop('D', 700, 700)])(job));
    await draw('customer=c-1');
    expect(q('stub-time')?.dataset.exact).toBe('true');
    await click(q('stub-add'));
    await click(q('stub-time'));
    await click(q('book-confirm'));
    expect(pv.bookPreview).toHaveBeenCalledTimes(1);
    expect(pv.bookPreview.mock.calls[0][0]).toMatchObject({ arrive_at: 840, customer_id: 'c-1', day: DAY, block: 'day', late_ok: [] });
    expect(ui.ask).not.toHaveBeenCalled();
    expect(api.bookJob).toHaveBeenCalledTimes(1);
    const [job] = api.bookJob.mock.calls[0];
    expect(job).toMatchObject({ arrive_at: 840, truck_id: 'T1', late_ok: [] });
    expect(nav.navigate).toHaveBeenCalledWith(`/job/${job.id}`, { replace: true });
    expect(map.openBookedMapOn).not.toHaveBeenCalled();
    expect(texts.notifyCustomer).toHaveBeenCalledWith('booking', job.id, expect.objectContaining({ customerId: 'c-1', when: expect.stringContaining('entre 13 h et 17 h') }));
    expect(ui.toast.mock.calls.at(-1)?.[0]).toContain('Réservé');
  });

  it('no room: the warning names Denis late; « Réserver quand même à 14 h » books with him accepted; then the NEW MAP of that day over its agenda, the new stop and Denis marked', async () => {
    pv.bookPreview.mockImplementation(async (job: { id: string }) => preview([stop('D', 700, 830, true, 50)])(job));
    api.bookJob.mockImplementation(async (job: { id: string; arrive_at?: number }) => ({ queued: false, id: job.id, data: { ok: true, exact: true, at: 840, job_id: job.id, truck_id: 'T1', forced: true,
      stops: [stop(job.id, 0, 840), stop('D', 700, 830, true, 50)], over_hours: 0, win_start: 780, win_end: 1020 } }));
    await draw('customer=c-1');
    await click(q('stub-add'));
    await click(q('stub-time'));
    await click(q('book-confirm'));
    expect(ui.ask).toHaveBeenCalledTimes(1);
    expect(ui.ask.mock.calls[0][0]).toMatchObject({ title: 'Réserver Julie à 14 h met Samir en retard', ok: 'Réserver quand même à 14 h', cancel: 'Choisir une autre heure', danger: true });
    const [job] = api.bookJob.mock.calls[0];
    expect(job.late_ok).toEqual(['D']);
    expect(map.openBookedMapOn).toHaveBeenCalledWith(`/agenda/${DAY}`, expect.objectContaining({ day: DAY, jobId: job.id, at: 840,
      marks: expect.arrayContaining([expect.objectContaining({ id: 'D', late: true, lateMin: 50 })]) }));
    expect(texts.notifyCustomer).toHaveBeenCalledTimes(1);
    expect(ui.toast.mock.calls.at(-1)?.[0]).toMatch(/Réservé quand même .* 14 h\. .*Samir/);
  });

  it('« Choisir une autre heure »: nothing booked, the screen stays', async () => {
    pv.bookPreview.mockImplementation(async (job: { id: string }) => preview([stop('D', 700, 830, true, 50)])(job));
    ui.ask.mockResolvedValue(false);
    await draw('customer=c-1');
    await click(q('stub-add'));
    await click(q('stub-time'));
    await click(q('book-confirm'));
    expect(api.bookJob).not.toHaveBeenCalled();
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(texts.notifyCustomer).not.toHaveBeenCalled();
  });

  it('no signal: booked as before (the window of that time, kept on the phone), no preview', async () => {
    net.value = { ...wasOnline, online: false };
    await draw('customer=c-1');
    await click(q('stub-add'));
    await click(q('stub-time'));
    await click(q('book-confirm'));
    expect(pv.bookPreview).not.toHaveBeenCalled();
    expect(api.bookJob).toHaveBeenCalledTimes(1);
    expect(api.bookJob.mock.calls[0][0]).toMatchObject({ day: DAY, block: 'day', win_start: 780 });
    expect(api.bookJob.mock.calls[0][0].arrive_at).toBeUndefined();
  });

  it('two cars: one appointment per car in that window, as before (no minute)', async () => {
    await draw('customer=c-2');
    const chip = (name: string) => [...box.querySelectorAll('[data-testid="vehicle-chips"] button')].find((b) => b.textContent?.includes(name)) ?? null;
    await click(chip('Corolla'));
    await click(q('stub-add'));
    await click(chip('Sienna'));
    await click(q('stub-add'));
    await click(q('stub-time'));
    await click(q('book-confirm'));
    expect(pv.bookPreview).not.toHaveBeenCalled();
    expect(api.bookJob).toHaveBeenCalledTimes(2);
    for (const [job] of api.bookJob.mock.calls) expect(job.arrive_at).toBeUndefined();
  });
});
