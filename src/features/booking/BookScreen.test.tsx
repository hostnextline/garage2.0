/* The booking screen drawn for real (the rows on the device, the server pretended): the flows that broke before the
   rebuild, end to end through the screen (booking-a-25). The calendar and the price list are replaced by two buttons;
   their own tests are theirs. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { BlockPickerProps } from '../../domain/moment/choice';
import type { ServicePickerProps } from '../../shared/moment/ServicePicker';

const api = vi.hoisted(() => ({
  bookJob: vi.fn(), walkIn: vi.fn(), suggestBlocks: vi.fn(), saveCustomer: vi.fn(), saveVehicle: vi.fn(),
  errorMessage: (e: unknown) => (e as Error).message
}));
const ui = vi.hoisted(() => ({ ask: vi.fn(), toast: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
const texts = vi.hoisted(() => ({ notifyCustomer: vi.fn(), wantsText: vi.fn() }));
// the address lookup at « Réserver » (Photon is never asked from a test): no answer unless a test says one
const places = vi.hoisted(() => ({ withPosition: vi.fn() }));
vi.mock('../../shared/places/withPosition', () => places);
vi.mock('../../data/api', async (orig) => ({ ...(await orig<typeof import('../../data/api')>()), ...api }));
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), ask: ui.ask, toast: ui.toast }));
vi.mock('../../platform/router', async (orig) => ({ ...(await orig<typeof import('../../platform/router')>()), navigate: nav.navigate }));
vi.mock('../../shared/moment/notify', () => texts);
vi.mock('../../shared/jobs/CarFirst', () => ({ OilHint: () => null }));
vi.mock('../../shared/moment/BlockPicker', () => ({
  BlockPicker: (p: BlockPickerProps) => (
    <>
      <button type="button" data-testid="stub-pick" data-reload={String(p.reload ?? 0)} onClick={() => p.onPick({ day: DAY, block: 'am' })}>{p.value ? `${p.value.day} ${p.value.block}` : 'none'}</button>
      {/* a picker that says it scored the moment chosen (far or not) and when its answer landed (m2) */}
      <button type="button" data-testid="stub-seen" onClick={() => p.onFar?.(null, { day: DAY, block: 'am', at: Date.now() })}>seen</button>
    </>
  )
}));
vi.mock('../../shared/moment/ServicePicker', () => ({
  ServicePicker: (p: ServicePickerProps) => (
    <div data-testid="stub-services" data-lines={p.value.map((i) => `${i.description}:${i.unit_cents}`).join(',')}>
      <button type="button" data-testid="stub-add" onClick={() => p.onValue([...p.value, { kind: 'service', service_id: 's-oil', description: 'Huile', qty: 1, unit_cents: 8999, taxable: true, duration_min: 45 }])}>+</button>
    </div>
  )
}));

import { upsertLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { setMyRoute } from '../../services/position';
import { bookingTyped } from './screen';
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
const lines = () => q('stub-services')?.dataset.lines ?? '';
const refusal = (code: string) => Object.assign(new Error(`refused ${code}`), { code: 'P0001', hint: code });
const sent = () => api.bookJob.mock.calls.map(([job]) => `${job.vehicle_id}:${job.id}`);

beforeEach(() => {
  lang.value = 'fr';
  access.value = { id: 'me', full_name: 'Bureau', short_name: null, email: null, phone: null, roles: ['office'], owner: false, lang: 'fr', prefs: {}, color: null,
    rights: { book: true, agenda: true, clients: true } as never, trucks: [] };
  upsertLocal('settings', [{ id: '1', booking: {}, taxes: { enabled: true, tps: 0.05, tvq: 0.09975 }, messages: { on: { booking: true } } }], { force: true });
  upsertLocal('trucks', [{ id: 'T1', name: 'Camion', active: true, sort: 0 }, { id: 'T2', name: 'Voiture', active: true, sort: 1 }], { force: true });
  upsertLocal('customers', [{ id: 'c-1', first_name: 'Julie', last_name: 'Tremblay', phone: '514 555-0141', address: '1 rue A', lat: 45.5, lng: -73.6 },
    { id: 'c-2', first_name: 'Samir', last_name: 'Haddad', phone: '514 555-0177', address: '2 rue B', lat: 45.52, lng: -73.64 }], { force: true });
  upsertLocal('vehicles', [{ id: 'v-1', customer_id: 'c-1', year: 2019, make: 'Honda', model: 'Civic' },
    { id: 'v-2a', customer_id: 'c-2', year: 2016, make: 'Toyota', model: 'Corolla' }, { id: 'v-2b', customer_id: 'c-2', year: 2019, make: 'Toyota', model: 'Sienna' }], { force: true });
  upsertLocal('quotes', [{ id: 'q-1', number: 7, customer_id: 'c-1', vehicle_id: null, items: [{ description: 'Freins', qty: 1, unit_cents: 34999, taxable: true, service_id: null }, { kind: 'discount', description: 'Rabais', qty: 1, unit_cents: -2000, taxable: true, service_id: null }], status: 'accepted', job_id: null }], { force: true });
  for (const f of [api.bookJob, api.walkIn, api.suggestBlocks, api.saveCustomer, api.saveVehicle, ui.ask, ui.toast, nav.navigate, texts.notifyCustomer, texts.wantsText, places.withPosition]) f.mockReset();
  places.withPosition.mockImplementation(async (p: unknown) => p);
  api.bookJob.mockImplementation(async (job: { id: string }) => ({ queued: false, id: job.id, data: {} }));
  api.suggestBlocks.mockResolvedValue([]);
  texts.wantsText.mockReturnValue(true);
  ui.ask.mockResolvedValue(true);
});
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; });

describe('the booking screen', () => {
  it('an estimate with no car, for a customer with one car: the car is chosen by itself and the estimate’s lines stay (booking-a-01)', async () => {
    await draw('quote=q-1');
    await wait(50);
    expect(lines()).toBe('Freins:34999,Rabais:-2000');
    await click(q('stub-pick'));
    await click(q('book-confirm'));
    expect(api.bookJob).toHaveBeenCalledTimes(1);
    expect(api.bookJob.mock.calls[0][0]).toMatchObject({ vehicle_id: 'v-1', quote_id: 'q-1', source: 'quote', day: DAY, block: 'am' });
    expect(nav.navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/job\//), { replace: true });
    expect(texts.notifyCustomer).toHaveBeenCalledTimes(1);
  });

  it('two cars, the second refused: the retry sends only the second one, with its own id (booking-a-02)', async () => {
    await draw('customer=c-2');
    const chip = (name: string) => [...box.querySelectorAll('[data-testid="vehicle-chips"] button')].find((b) => b.textContent?.includes(name)) ?? null;
    await click(chip('Corolla'));
    await click(q('stub-add'));
    await click(chip('Sienna'));
    await click(q('stub-add'));
    await click(q('stub-pick'));
    api.bookJob.mockImplementation(async (job: { id: string; vehicle_id: string }) => {
      if (job.vehicle_id === 'v-2a') throw refusal('block_started');
      return { queued: false, id: job.id, data: {} };
    });
    await click(q('book-confirm'));
    const [first, second] = sent();
    expect(first.startsWith('v-2b:') && second.startsWith('v-2a:')).toBe(true);
    expect(nav.navigate).not.toHaveBeenCalled();
    api.bookJob.mockClear();
    api.bookJob.mockImplementation(async (job: { id: string }) => ({ queued: false, id: job.id, data: {} }));
    await click(q('stub-pick'));
    await click(q('book-confirm'));
    expect(sent()).toEqual([second]);
    // the one appointment left is booked: its job opens
    expect(nav.navigate).toHaveBeenCalledWith(`/job/${second.split(':')[1]}`, { replace: true });
  });

  it('a block refused (« Ce bloc est plein »): the picker asks its moments again, the block stays chosen with the reason (R79)', async () => {
    await draw('customer=c-1');
    await click(q('stub-add'));
    await click(q('stub-pick'));
    expect(q('stub-pick')?.dataset.reload).toBe('0');
    api.bookJob.mockRejectedValueOnce(refusal('block_full'));
    // « Réserver quand même ? » answered « Choisir un autre bloc »
    ui.ask.mockResolvedValue(false);
    await click(q('book-confirm'));
    expect(api.bookJob).toHaveBeenCalledTimes(1);
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(q('stub-pick')?.dataset.reload).toBe('1');
    expect(q('stub-pick')?.textContent).toBe(`${DAY} am`);
  });

  it('the call banner knows when a booking is half typed here, and forgets it with the screen (x-reactivity-19)', async () => {
    await draw('customer=c-1');
    expect(bookingTyped.value).toBe(false);
    await click(q('stub-add'));
    expect(bookingTyped.value).toBe(true);
    act(() => render(null, box));
    expect(bookingTyped.value).toBe(false);
  });

  it('two cars kept on the phone: said once, the screen leaves (booking-a-03)', async () => {
    await draw('customer=c-2');
    const chips = () => [...box.querySelectorAll('[data-testid="vehicle-chips"] button')] as HTMLElement[];
    await click(chips()[0]);
    await click(q('stub-add'));
    await click(chips()[1]);
    await click(q('stub-add'));
    await click(q('stub-pick'));
    api.bookJob.mockImplementation(async (job: { id: string }) => ({ queued: true, id: job.id }));
    await click(q('book-confirm'));
    expect(api.bookJob).toHaveBeenCalledTimes(2);
    expect(ui.toast).toHaveBeenCalledTimes(1);
    // where the text is sent from, said right: the appointment, or the day before in « À confirmer pour demain »
    expect(ui.toast.mock.calls[0][0]).toMatch(/Renvoyer le texto de confirmation/);
    expect(ui.toast.mock.calls[0][0]).toMatch(/la veille dans « À confirmer pour demain »/);
    expect(nav.navigate).toHaveBeenCalledWith(`/agenda/${DAY}`, { replace: true });
    expect(texts.notifyCustomer).not.toHaveBeenCalled();
  });

  it('a new caller: « Réserver » tapped without the name shows what to write (booking-a-11)', async () => {
    await draw('call=1&start=job');
    await click(q('stub-add'));
    await click(q('stub-pick'));
    const button = q('book-confirm') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toMatch(/prénom et le numéro/);
    await click(button);
    expect(q('call-who')?.textContent).toMatch(/Écris le prénom/);
    expect(api.saveCustomer).not.toHaveBeenCalled();
  });

  it('« Beaucoup de route ce jour-là » is asked for the moment chosen, even when the calendar did not know (booking-a-10)', async () => {
    api.suggestBlocks.mockResolvedValue([{ day: DAY, block: 'am', truck: 'T1', far: 'day', day_min: 140, add_min: 70, stops: 3, drive_min: 20, near: 0, left: 100 }]);
    ui.ask.mockResolvedValue(false);
    await draw('customer=c-1');
    await click(q('stub-add'));
    await click(q('stub-pick'));
    await click(q('book-confirm'));
    expect(api.suggestBlocks).toHaveBeenCalledWith(45.5, -73.6, 45, DAY, 1, null, false, null);
    expect(ui.ask.mock.calls[0][0].title).toBe('Beaucoup de route ce jour-là');
    expect(api.bookJob).not.toHaveBeenCalled();
  });

  it('the calendar scored the moment chosen a moment ago, not far: « Réserver » does not ask the server again (m2)', async () => {
    await draw('customer=c-1');
    await click(q('stub-add'));
    await click(q('stub-pick'));
    await click(q('stub-seen'));
    await click(q('book-confirm'));
    expect(api.suggestBlocks).not.toHaveBeenCalled();
    expect(api.bookJob).toHaveBeenCalledTimes(1);
  });

  it('what is typed while « Réserver » waits for the garde-route answer is what gets booked', async () => {
    let answer: (rows: unknown[]) => void = () => undefined;
    api.suggestBlocks.mockImplementation(() => new Promise((r) => { answer = r; }));
    await draw('customer=c-1');
    await click(q('stub-add'));
    await click(q('stub-pick'));
    await click(q('book-confirm'));
    expect(api.bookJob).not.toHaveBeenCalled();
    // a second service added while the server is asked
    await click(q('stub-add'));
    await act(async () => { answer([]); });
    await wait();
    expect(api.bookJob).toHaveBeenCalledTimes(1);
    expect(api.bookJob.mock.calls[0][1]).toHaveLength(2);
    expect(api.bookJob.mock.calls[0][0]).toMatchObject({ vehicle_id: 'v-1', duration_min: 90 });
  });

  it('a new caller refused once, the number fixed before the retry: the same file gets the right number (booking-a-09)', async () => {
    api.saveCustomer.mockImplementation(async (c: Record<string, unknown>) => {
      const id = (c.id as string) || 'c-new';
      upsertLocal('customers', [{ ...c, id }], { force: true });
      return id;
    });
    await draw('call=1&start=job&phone=438%20555-0100&name=Mario');
    const street = () => box.querySelector('[data-testid="call-address"] [data-testid="address-input"]') as HTMLInputElement;
    await act(async () => { street().value = '99 rue Typed'; street().dispatchEvent(new Event('input', { bubbles: true })); });
    await wait();
    await click(q('stub-add'));
    await click(q('stub-pick'));
    api.bookJob.mockImplementationOnce(async () => { throw refusal('block_started'); });
    await click(q('book-confirm'));
    expect(api.saveCustomer).toHaveBeenCalledTimes(1);
    expect(api.saveCustomer.mock.calls[0][0]).toMatchObject({ phone: '438 555-0100', address: '99 rue Typed' });
    // « Changer »: back to the caller's fields (the address said during the call still there), the number fixed, « Réserver » again
    await click([...box.querySelectorAll('[data-testid="customer-picked"] button')].at(-1)!);
    expect(street().value).toBe('99 rue Typed');
    const tel = box.querySelector('[data-testid="call-who"] input[type=tel]') as HTMLInputElement;
    await act(async () => { tel.value = '438 555-0199'; tel.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait();
    await click(q('stub-pick'));
    await click(q('book-confirm'));
    expect(api.saveCustomer).toHaveBeenCalledTimes(2);
    // only the number goes to the file: its address is never emptied
    expect(api.saveCustomer.mock.calls[1][0]).toEqual({ id: 'c-new', phone: '438 555-0199' });
    expect(api.bookJob.mock.calls.at(-1)![0]).toMatchObject({ customer_id: 'c-new', address: '99 rue Typed' });
  });

  it('a new caller’s address typed right before « Réserver »: the file and the appointment go with its position (R164)', async () => {
    api.saveCustomer.mockImplementation(async (c: Record<string, unknown>) => { upsertLocal('customers', [{ ...c, id: 'c-new' }], { force: true }); return 'c-new'; });
    // the field's own lookup has not answered yet: the place on screen has no position; the one asked at the tap finds it
    places.withPosition.mockImplementation(async (p: { address: string }) => (p.address.trim() === '99 rue Typed' ? { ...p, lat: 45.51, lng: -73.62, city: 'Montréal' } : p));
    await draw('call=1&start=job&phone=438%20555-0100&name=Mario');
    const street = box.querySelector('[data-testid="call-address"] [data-testid="address-input"]') as HTMLInputElement;
    await act(async () => { street.value = '99 rue Typed'; street.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait();
    await click(q('stub-add'));
    await click(q('stub-pick'));
    await click(q('book-confirm'));
    expect(places.withPosition).toHaveBeenCalledWith(expect.objectContaining({ address: '99 rue Typed', lat: null }));
    expect(api.saveCustomer.mock.calls[0][0]).toMatchObject({ address: '99 rue Typed', lat: 45.51, lng: -73.62, city: 'Montréal' });
    expect(api.bookJob.mock.calls[0][0]).toMatchObject({ customer_id: 'c-new', address: '99 rue Typed', lat: 45.51, lng: -73.62 });
  });

  it('an estimate for two cars, the second refused: the estimate’s own appointment does not stop the retry, which goes without the estimate (booking-a-08)', async () => {
    const q2 = { id: 'q-2', number: 8, customer_id: 'c-2', vehicle_id: null, items: [{ description: 'Freins', qty: 1, unit_cents: 34999, taxable: true, service_id: null }], status: 'accepted', job_id: null };
    upsertLocal('quotes', [q2], { force: true });
    await draw('quote=q-2');
    await wait(50);
    const chip = (name: string) => [...box.querySelectorAll('[data-testid="vehicle-chips"] button')].find((b) => b.textContent?.includes(name)) ?? null;
    await click(chip('Corolla'));
    expect(lines()).toBe('Freins:34999');
    await click(chip('Sienna'));
    await click(q('stub-add'));
    await click(q('stub-pick'));
    api.bookJob.mockImplementation(async (job: { id: string; vehicle_id: string }) => {
      if (job.vehicle_id === 'v-2a') throw refusal('block_started');
      return { queued: false, id: job.id, data: {} };
    });
    await click(q('book-confirm'));
    const [first, second] = api.bookJob.mock.calls.map(([job]) => job);
    expect(first).toMatchObject({ vehicle_id: 'v-2b', quote_id: 'q-2', source: 'quote' });
    expect(second).toMatchObject({ vehicle_id: 'v-2a', quote_id: null });
    // the server marks the estimate booked with the first appointment; the rows reach the phone
    upsertLocal('jobs', [{ id: first.id, customer_id: 'c-2', vehicle_id: 'v-2b', day: DAY, block: 'am', status: 'booked' }], { force: true });
    upsertLocal('quotes', [{ ...q2, status: 'converted', job_id: first.id }], { force: true });
    await wait();
    const button = q('book-confirm') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).not.toMatch(/déjà réservée/);
    api.bookJob.mockClear();
    api.bookJob.mockImplementation(async (job: { id: string }) => ({ queued: false, id: job.id, data: {} }));
    await click(q('stub-pick'));
    await click(q('book-confirm'));
    expect(api.bookJob).toHaveBeenCalledTimes(1);
    expect(api.bookJob.mock.calls[0][0]).toMatchObject({ id: second.id, vehicle_id: 'v-2a', quote_id: null, source: 'quote' });
    expect(nav.navigate).toHaveBeenCalledWith(`/job/${second.id}`, { replace: true });
  });

  it('an estimate already booked is not booked again (booking-a-08)', async () => {
    upsertLocal('jobs', [{ id: 'j-q', customer_id: 'c-1', day: DAY, block: 'am', status: 'booked' }], { force: true });
    upsertLocal('quotes', [{ id: 'q-1', number: 7, customer_id: 'c-1', vehicle_id: 'v-1', items: [], status: 'converted', job_id: 'j-q' }], { force: true });
    await draw('quote=q-1');
    await click(q('stub-add'));
    await click(q('stub-pick'));
    const button = q('book-confirm') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toMatch(/déjà réservée/);
  });

  it('the owner’s walk-in names its vehicle (booking-a-13)', async () => {
    access.value = { ...access.value!, owner: true, roles: ['owner'] };
    api.walkIn.mockImplementation(async (job: { id: string }) => ({ queued: false, id: job.id }));
    await draw('walkin=1&customer=c-1');
    await click(q('stub-add'));
    expect((q('book-confirm') as HTMLButtonElement).disabled).toBe(true);
    await click(q('book-truck')!.querySelector('button'));
    await click(q('book-confirm'));
    expect(api.walkIn.mock.calls[0][0]).toMatchObject({ truck_id: 'T1', customer_id: 'c-1', vehicle_id: 'v-1' });
  });

  it('Routes partagées: a mechanic’s walk-in starts on « La route que je fais », and another vehicle can still be chosen (R73)', async () => {
    access.value = { ...access.value!, owner: true, roles: ['owner', 'mechanic'], trucks: ['T1', 'T2'] };
    setMyRoute('T2');
    try {
      api.walkIn.mockImplementation(async (job: { id: string }) => ({ queued: false, id: job.id }));
      await draw('walkin=1&customer=c-1');
      await click(q('stub-add'));
      const chips = () => [...q('book-truck')!.querySelectorAll('button')] as HTMLButtonElement[];
      expect(chips().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
      expect((q('book-confirm') as HTMLButtonElement).disabled).toBe(false);
      await click(q('book-confirm'));
      expect(api.walkIn.mock.calls[0][0]).toMatchObject({ truck_id: 'T2', customer_id: 'c-1' });
      // the other vehicle chosen by hand wins
      act(() => render(null, box));
      api.walkIn.mockClear();
      await draw('walkin=1&customer=c-1');
      await click(q('stub-add'));
      await click(chips()[0]);
      await click(q('book-confirm'));
      expect(api.walkIn.mock.calls[0][0]).toMatchObject({ truck_id: 'T1' });
    } finally { setMyRoute(null); }
  });
});
