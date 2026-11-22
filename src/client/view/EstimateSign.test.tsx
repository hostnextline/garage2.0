/* « J’accepte … {total} » is ticked for a total (terrain-03, client-r1): when the file read again on the way back to the
   tab shows another total, the box is no longer ticked and the drawn signature is not sent for an amount never agreed to. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { JobView } from '../api';
import type { Stroke } from '../../shared/sign/signature';

// the finger on the pad: a button that gives a long enough stroke (jsdom draws nothing)
vi.mock('../../shared/sign/SignaturePad', () => ({
  SignaturePad: (p: { onStrokes: (s: Stroke[]) => void }) => (
    <button type="button" data-testid="pad-draw" onClick={() => p.onStrokes([[{ x: 10, y: 10 }, { x: 200, y: 80 }, { x: 20, y: 150 }, { x: 260, y: 160 }] as unknown as Stroke])} />
  )
}));
import { EstimateSign } from './EstimateSign';

function job(total: number): JobView {
  return {
    ok: true, kind: 'job', garage: { name: 'Garage', phone: '438 901-6606' }, lang: 'fr', customer: { first: 'Julie' },
    job: { number: 118, day: '2026-11-20', block: 'pm', start: 720, end: 960, status: 'booked', tracking: false, vehicle: null, waiver_signed: false },
    items: [], extras: [], expected: { subtotal: total, tps: 0, tvq: 0, total }, prepaid_cents: 0, invoice: null,
    estimate: { signed_at: null, signer: null, cents: null, changed: false, can_sign: true }, conditions: null, bill: null,
    pay: { available: false, amount_cents: total, kind: 'prepay', pending: false }
  };
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null;
const sp = (s: string | null | undefined) => String(s).replace(/\s/g, ' ');
afterEach(() => act(() => render(null, box)));

describe('the drawn signature and a total that moved (terrain-03)', () => {
  it('the box ticked for 150 $ is unticked when the file now says 180 $; « Signer » asks to tick again, nothing is sent', async () => {
    const onSign = vi.fn(async () => ({ ok: true as const }));
    const draw = (v: JobView) => act(() => { render(<EstimateSign v={v} l="fr" onSign={onSign} />, box); });
    await draw(job(15000));
    await act(() => { q('client-sign-open')!.click(); });
    await act(() => {
      const n = q('client-sign-name')!; n.value = 'Julie Roy'; n.dispatchEvent(new Event('input', { bubbles: true }));
      q('pad-draw')!.click();
      q('client-sign-agree')!.click();
    });
    expect(q('client-sign-agree')!.checked).toBe(true);
    expect(sp(box.textContent)).toContain('150,00 $');
    // the page reads the file again (back on the tab): the mechanic added work
    await draw(job(18000));
    expect(q('client-sign-agree')!.checked).toBe(false);
    expect(sp(q('client-sign-moved')!.textContent)).toContain('Le nouveau total est de 180,00 $');
    await act(() => { q('client-sign-submit')!.click(); });
    expect(onSign).not.toHaveBeenCalled();
    expect(sp(box.textContent)).toContain('Cochez');
    // ticked again for what it says now: the signature goes
    await act(() => { q('client-sign-agree')!.click(); });
    expect(q('client-sign-moved')).toBeNull();
    await act(async () => { q('client-sign-submit')!.click(); });
    expect(onSign).toHaveBeenCalledTimes(1);
  });
  it('the same total read again keeps the box ticked', async () => {
    const onSign = vi.fn(async () => ({ ok: true as const }));
    await act(() => { render(<EstimateSign v={job(15000)} l="fr" onSign={onSign} />, box); });
    await act(() => { q('client-sign-open')!.click(); });
    await act(() => { q('client-sign-agree')!.click(); });
    await act(() => { render(<EstimateSign v={job(15000)} l="fr" onSign={onSign} />, box); });
    expect(q('client-sign-agree')!.checked).toBe(true);
    expect(q('client-sign-moved')).toBeNull();
  });
});
