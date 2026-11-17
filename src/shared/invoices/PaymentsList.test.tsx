/* The payments of an invoice: today's are said with their time, on the garage's clock (Montréal), whatever zone the
   phone is set to (R169; this file runs with TZ=UTC and TZ=Asia/Tokyo too). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { lang } from '../../lib/i18n';
import type { Payment } from '../../data/types';
import { PaymentsList } from './PaymentsList';

const box = document.createElement('div');
document.body.appendChild(box);
const pay = (paid_at: string) => ({ id: 'p-1', invoice_id: 'f-1', job_id: 'j-1', amount_cents: 11498, method: 'cash', reference: null, paid_at, deleted_at: null }) as unknown as Payment;

beforeEach(() => {
  lang.value = 'fr';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T20:00:00Z'));   // 17 Nov, 15 h in Montréal
});
afterEach(() => { act(() => render(null, box)); vi.useRealTimers(); });

describe('when a payment was taken', () => {
  it('today: its time on the garage clock (15:10 UTC is 10 h 10 in Montréal)', () => {
    act(() => render(<PaymentsList pays={[pay('2026-11-17T15:10:00Z')]} />, box));
    expect(box.querySelector('[data-testid="payments"]')?.textContent).toContain('10 h 10');
  });
  it('another day: its date and time on the garage clock', () => {
    act(() => render(<PaymentsList pays={[pay('2026-11-16T15:10:00Z')]} />, box));
    expect(box.querySelector('[data-testid="payments"]')?.textContent).toMatch(/16 nov\. 2026, 10 h 10/);
  });
});
