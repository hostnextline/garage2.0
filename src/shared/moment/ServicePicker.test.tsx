/* The services of a booking: the amounts of the lines chosen (booking-a-17, x-deadcode-19). */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { clearAll } from '../../data/store';
import { lang } from '../../lib/i18n';
import type { ItemDraft } from '../../domain/moment/logic';
import { ServicePicker } from './ServicePicker';

const box = document.createElement('div');
document.body.appendChild(box);
const line = (o: Partial<ItemDraft>): ItemDraft => ({ kind: 'service', service_id: null, item_id: null, description: 'Vidange', qty: 1, unit_cents: 10000, taxable: true, duration_min: 30, note: null, ...o });
beforeEach(() => { lang.value = 'fr'; });
afterEach(() => { act(() => render(null, box)); clearAll(); });

describe('the lines chosen', () => {
  // a discount whose price was changed on the job is stored negative (job_item_price: -abs), and « Copier le rendez-vous »
  // copies it as it is: before, -1000 × -1 showed +10 $ and the subtotal added it
  it('a discount always lowers, whatever the sign it is stored with', () => {
    act(() => render(<ServicePicker value={[line({}), line({ kind: 'discount', description: 'Rabais', unit_cents: -2000, duration_min: null }), line({ kind: 'discount', description: 'Promo', unit_cents: 500, duration_min: null })]} onValue={() => {}} />, box));
    const amounts = [...box.querySelectorAll('.svc-line .money')].map((x) => x.textContent?.replace(/\s/g, ''));
    expect(amounts).toEqual(['100,00$', '-20,00$', '-5,00$']);
    expect(box.querySelector('.svc-total .money')?.textContent?.replace(/\s/g, '')).toBe('75,00$');
  });
  it('quantities multiply', () => {
    act(() => render(<ServicePicker value={[line({ kind: 'part', qty: 3, unit_cents: 1250 })]} onValue={() => {}} />, box));
    expect(box.querySelector('.svc-line .money')?.textContent?.replace(/\s/g, '')).toBe('37,50$');
  });
});
