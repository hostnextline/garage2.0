/* « Historique du véhicule »: which visit says « À venir ». */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { lang } from '../../lib/i18n';
import { today } from '../../lib/dates';
import type { VinVisit } from '../../data/api';
import { VinVisits } from './VinHistory';

const box = document.createElement('div');
document.body.appendChild(box);
const visit = (job_id: string, day: string, status: string): VinVisit => ({ job_id, number: 1000, day, status, here: true, open: false, work: ['Vidange'] });
const pills = () => [...box.querySelectorAll('[data-testid="vin-visit"]')].map((r) => r.textContent?.includes('À venir'));

beforeEach(() => { lang.value = 'fr'; });
afterEach(() => { act(() => render(null, box)); });

describe('« À venir » in the car\'s history', () => {
  it('a visit to come, or booked today, is « À venir »; one done, or left booked on a day gone by, is not (customers-b-19)', () => {
    act(() => render(<VinVisits owners={false} visits={[
      visit('a', '2099-03-01', 'booked'),
      visit('b', today(), 'booked'),
      visit('c', '2020-03-01', 'booked'),
      visit('d', '2020-02-01', 'done')
    ]} />, box));
    expect(pills()).toEqual([true, true, false, false]);
  });
});
