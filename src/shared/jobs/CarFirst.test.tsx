/* The oil line of the booking screen: « Compléter » may open the car's sheet in place, so the booking form is kept (R76). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { upsertLocal, clearAll } from '../../data/store';
import { OilHint } from './CarFirst';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => { act(() => render(null, box)); clearAll(); });
const car = { id: 'v1', customer_id: 'c1', year: 2019, make: 'Honda', model: 'Civic', spec_key: null };

describe('« Compléter » under the car chosen in the booking (R76)', () => {
  it('with onComplete: the sheet opens in place, the page does not leave the booking', async () => {
    upsertLocal('vehicles', [car]);
    location.hash = '#/book';
    const done = vi.fn();
    await act(() => render(<OilHint vehicleId="v1" onComplete={done} />, box));
    const link = box.querySelector('[data-testid="book-oil-fill"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    await act(async () => { link.click(); });
    expect(done).toHaveBeenCalledWith('v1');
    expect(location.hash).toBe('#/book');
  });
  it('without it: the link to the car’s file, as before', async () => {
    upsertLocal('vehicles', [car]);
    await act(() => render(<OilHint vehicleId="v1" />, box));
    expect((box.querySelector('[data-testid="book-oil-fill"]') as HTMLAnchorElement).getAttribute('href')).toBe('#/vehicle/v1');
  });
});
