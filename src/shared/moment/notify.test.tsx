/* After a booking or a move: is a text wanted, and what the person is told of the server's answer (x-contract-10). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({ notify: vi.fn(), errorMessage: (e: unknown) => String((e as Error)?.message || e) }));
const ui = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../data/api', () => api);
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), toast: ui.toast }));

import { upsertLocal, clearAll } from '../../data/store';
import { lang } from '../../lib/i18n';
import { notifyCustomer, wantsText } from './notify';

beforeEach(() => {
  lang.value = 'fr';
  ui.toast.mockReset();
  api.notify.mockReset();
  upsertLocal('customers', [{ id: 'C1', first_name: 'Amira', phone: '5145550141', sms_ok: true }], { force: true });
  upsertLocal('jobs', [{ id: 'J1', customer_id: 'C1', day: '2026-11-20', block: 'am', status: 'booked', duration_min: 60, number: 1 }], { force: true });
});
afterEach(() => clearAll());

describe('a text after a booking or a move', () => {
  // the server (notify: quiet only on `false`) and Réglages read a switch the settings do not hold yet as ON; the booking
  // and move screens read it as off, so no text was asked although Réglages showed the switch on
  it('a switch not written in the settings yet is on, as for the server', () => {
    upsertLocal('settings', [{ id: '1', messages: { on: {} } }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(true);
    upsertLocal('settings', [{ id: '1', messages: { on: { booking: false } } }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(false);
    upsertLocal('settings', [{ id: '1', messages: { on: { moved: true } } }], { force: true });
    expect(wantsText('moved', 'J1')).toBe(true);
  });
  it('no number, or a customer who refuses texts: none', () => {
    upsertLocal('customers', [{ id: 'C1', first_name: 'Amira', phone: '5145550141', sms_ok: false }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(false);
    upsertLocal('customers', [{ id: 'C1', first_name: 'Amira', phone: null, sms_ok: true }], { force: true });
    expect(wantsText('booking', 'J1')).toBe(false);
  });
  // the server answers « quiet » when the customer refuses texts or the kind is switched off: before, the person got the
  // red « Le texto n'est pas parti. » with no reason
  it('« quiet » is said calmly, not as a failure', async () => {
    api.notify.mockResolvedValue({ ok: false, status: 'quiet' });
    await notifyCustomer('booking', 'J1');
    expect(ui.toast).toHaveBeenCalledTimes(1);
    expect(ui.toast.mock.calls[0][0]).toBe('Pas de texto : ce client ou ce type de texto est désactivé.');
    expect(ui.toast.mock.calls[0][1]?.kind).toBeUndefined();
  });
  it('sent, failed', async () => {
    api.notify.mockResolvedValue({ ok: true, status: 'sent' });
    await notifyCustomer('booking', 'J1');
    expect(ui.toast.mock.calls.at(-1)).toEqual(['Texto de confirmation envoyé', { kind: 'ok' }]);
    api.notify.mockRejectedValue(new Error('boom'));
    await notifyCustomer('moved', 'J1');
    expect(ui.toast.mock.calls.at(-1)).toEqual(['Le texto n’est pas parti. boom', { kind: 'bad' }]);
  });
});
