/* The appointment page against a pretend « client » function: what it sends and what the customer reads.
   Each case is a bug of the scan (the old page failed it). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { JobView } from '../api';

const calls: { action: string; body: Record<string, unknown> }[] = [];
let server: (action: string, body: Record<string, unknown>) => unknown = () => ({});
vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  return { ...real, callClient: async (action: string, _token: string, body: Record<string, unknown> = {}) => { calls.push({ action, body }); return server(action, body); } };
});
import { ViewPage } from './ViewPage';
import { ClientError } from '../api';
import { rememberPaying } from '../link';

const TOKEN = 'tok-appointment-0123456789';
function job(o: Partial<JobView> = {}, j: Partial<JobView['job']> = {}): JobView {
  return {
    ok: true, kind: 'job', garage: { name: 'Garage', phone: '438 901-6606' }, lang: 'fr', customer: { first: 'Julie' },
    job: { number: 118, day: '2026-11-20', block: 'pm', start: 720, end: 960, status: 'booked', tracking: false, vehicle: null, waiver_signed: false, ...j },
    items: [{ id: 'a', description: 'Huile', qty: 1, unit_cents: 15998, status: 'planned' }],
    extras: [],
    expected: { subtotal: 15998, tps: 800, tvq: 1596, total: 18394 }, prepaid_cents: 0, invoice: null,
    estimate: { signed_at: null, signer: null, cents: null, changed: false, can_sign: true }, conditions: null, bill: null,
    pay: { available: false, amount_cents: 18394, kind: 'prepay', pending: false }, ...o
  };
}
const signed = (v: JobView): JobView => ({ ...v, estimate: { signed_at: '2026-11-17T15:00:00Z', signer: 'Julie Roy', cents: v.expected.total, changed: false, can_sign: false } });

const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => [...box.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const sp = (s: string | null | undefined) => String(s).replace(/\s/g, ' ');
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await wait(); await wait(); };
async function open(o: { retour?: string | null; lang?: 'fr' | 'en' | null } = {}) {
  await act(async () => { render(<ViewPage token={TOKEN} linkLang={o.lang ?? null} retour={o.retour ?? null} onLang={() => undefined} />, box); });
  await wait(); await wait();
}
beforeEach(() => { calls.length = 0; localStorage.clear(); sessionStorage.clear(); });
afterEach(() => act(() => render(null, box)));

describe('signing for the amount shown (client-page-01)', () => {
  it('« J’accepte et je signe » sends the total the page shows', async () => {
    const v = job();
    server = (a) => (a === 'sign' ? signed(v) : v);
    await open();
    await click(q('client-sign-click')[0]);
    const sent = calls.find((c) => c.action === 'sign')!.body;
    expect(sent).toMatchObject({ click: true, confirm: true, shown_cents: 18394 });
    expect(q('client-signed')).toHaveLength(1);
  });
  it('the price moved meanwhile: nothing signed, the new total is shown and asked again', async () => {
    const old = job();
    const now = job({ items: [{ id: 'a', description: 'Huile', qty: 1, unit_cents: 25998, status: 'planned' }], expected: { subtotal: 25998, tps: 1300, tvq: 2593, total: 29891 } });
    let current = old;
    server = (a) => {
      if (a === 'sign') { current = now; throw new ClientError('amount_changed', 'Le montant a changé.', null, 29891); }
      return current;
    };
    await open();
    expect(sp(q('client-expected')[0].textContent)).toBe('159,98 $ + tx');
    await click(q('client-sign-click')[0]);
    expect(calls.filter((c) => c.action === 'view')).toHaveLength(2);           // the file read again
    expect(sp(q('client-expected')[0].textContent)).toBe('259,98 $ + tx');
    expect(sp(box.textContent)).toContain('Le nouveau total est de 298,91 $, taxes incluses');
    expect(q('client-sign-click')).toHaveLength(1);                              // asked again
    expect(q('client-signed')).toHaveLength(0);
  });
});

describe('answering extra work for the price shown (client-page-01, 26)', () => {
  const extra = { id: 'x1', description: 'Étriers', qty: 1, unit_cents: 8000, total_cents: 8000, status: 'proposed', note: null, answered_via: null };
  it('sends the price shown; a price changed meanwhile brings the choice back with the new price', async () => {
    let current = job({ extras: [extra] }, { status: 'on_site' });
    server = (a) => {
      if (a === 'answer') { current = job({ extras: [{ ...extra, unit_cents: 12000, total_cents: 12000 }] }, { status: 'on_site' }); throw new ClientError('amount_changed', 'x', null, 12000); }
      return current;
    };
    await open();
    await click(q('client-extra-accept')[0]);
    await click(q('client-extra-confirm')[0]);
    expect(calls.find((c) => c.action === 'answer')!.body).toMatchObject({ item_id: 'x1', accept: true, confirm: true, shown_cents: 8000 });
    expect(sp(box.textContent)).toContain('il est maintenant de 120,00 $');
    expect(q('client-extra-confirm')).toHaveLength(0);                           // back to Accepter / Refuser
    expect(q('client-extra-accept')).toHaveLength(1);
  });
  it('another phone answered first: says so instead of thanking', async () => {
    const before = job({ extras: [extra] }, { status: 'on_site' });
    server = (a) => (a === 'answer' ? { ...before, extras: [{ ...extra, status: 'approved' }] } : before);
    await open();
    await click(q('client-extra-decline')[0]);
    await click(q('client-extra-confirm')[0]);
    expect(sp(q('client-thanks')[0].textContent)).toContain('il est accepté');
    expect(sp(box.textContent)).not.toContain('Votre réponse est envoyée');
  });
  it('a proposal left unanswered is not offered on a finished, paid job (client-page-05)', async () => {
    const inv = { number: 'F-0001', issued_at: null, due_on: null, status: 'paid', lines: [], subtotal_cents: 15998, tps_cents: 800, tvq_cents: 1596, total_cents: 18394, paid_cents: 18394, notes: null };
    server = () => job({ extras: [extra], invoice: inv }, { status: 'done' });
    await open();
    expect(q('client-invoice')).toHaveLength(1);
    expect(q('client-extras')).toHaveLength(0);
    expect(q('client-extra-accept')).toHaveLength(0);
  });
});

describe('a refused or lost signature (client-page-12)', () => {
  it('an English page says it in English and shows the file as it is now', async () => {
    const v = job({ lang: 'en' });
    let current = v;
    server = (a) => { if (a === 'sign') { current = signed(v); throw new ClientError('signed', 'Cette estimation est déjà signée.'); } return current; };
    await open({ lang: 'en' });
    await click(q('client-sign-click')[0]);
    expect(box.textContent).not.toContain('Cette estimation');
    expect(q('client-signed')).toHaveLength(1);
    expect(q('client-sign-click')).toHaveLength(0);
  });
  it('the answer was lost but the signature went through: no « did not go »', async () => {
    const v = job();
    let current = v;
    server = (a) => { if (a === 'sign') { current = signed(v); throw new ClientError('network', 'aborted'); } return current; };
    await open();
    await click(q('client-sign-click')[0]);
    expect(q('client-signed')).toHaveLength(1);
    expect(sp(box.textContent)).not.toContain('La signature n’est pas partie');
  });
});

describe('« Suivre le camion en direct » (client-page-04)', () => {
  it('opens the trip of this appointment (its own link), never an older trip kept on the phone', async () => {
    localStorage.setItem('his.client.suivi', JSON.stringify({ token: 'OLD-TRIP-TOKEN', at: Date.now() }));
    server = () => job({}, { status: 'en_route', tracking: true });
    await open();
    const a = q('client-track-link')[0] as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe(`#suivi=${TOKEN}&l=fr`);
  });
});

describe('payment (client-page-06, 07, 31, 23)', () => {
  const invoice = (paid: number, total = 18394) => ({ number: 'F-0001', issued_at: null, due_on: null, status: paid >= total ? 'paid' : 'issued', lines: [], subtotal_cents: 15998, tps_cents: 800, tvq_cents: 1596, total_cents: total, paid_cents: paid, notes: null });
  it('a card page already open: the page asks Stripe at once, and the « s’affichera ici » note goes', async () => {
    const before = job({ invoice: invoice(0), pay: { available: true, amount_cents: 18394, kind: 'invoice', pending: true } }, { status: 'done' });
    const after = job({ invoice: invoice(18394), pay: { available: false, amount_cents: 0, kind: 'invoice', pending: true } }, { status: 'done' });
    server = (a) => (a === 'check' ? after : before);
    await open();
    expect(calls.map((c) => c.action)).toEqual(['view', 'check']);
    expect(q('client-stamp')).toHaveLength(1);
    expect(q('client-paid-note')).toHaveLength(1);
    expect(sp(box.textContent)).not.toContain('Un paiement par carte a été commencé');
  });
  it('back from Stripe with a balance still left (the total rose): « paiement reçu », not « n’apparaît pas encore »', async () => {
    rememberPaying(TOKEN, 0);
    // 229,94 $ paid ahead came in; an extra accepted meanwhile leaves 80,49 $
    server = () => job({ prepaid_cents: 22994, expected: { subtotal: 27000, tps: 1350, tvq: 2693, total: 31043 }, pay: { available: true, amount_cents: 8049, kind: 'prepay', pending: true } }, { status: 'on_site' });
    await open({ retour: 'paye' });
    expect(q('client-paid-note')).toHaveLength(1);
    expect(q('client-checking')).toHaveLength(0);
    expect(calls.filter((c) => c.action === 'check')).toHaveLength(1);
  });
  it('back from Stripe, the « Paiement en vérification… » note shows from the first moment (not grey boxes alone)', async () => {
    server = () => new Promise(() => undefined);                                  // the first check is slow
    await act(async () => { render(<ViewPage token={TOKEN} linkLang={null} retour="paye" onLang={() => undefined} />, box); });
    await wait();
    expect(q('client-checking')).toHaveLength(1);
  });
  it('the card page opens in the page’s language', async () => {
    server = (a) => (a === 'pay' ? { ok: true } : job({ lang: 'fr', invoice: invoice(0), pay: { available: true, amount_cents: 18394, kind: 'invoice', pending: false } }, { status: 'done' }));
    await open({ lang: 'en' });
    await click(q('client-pay-button')[0]);
    expect(calls.find((c) => c.action === 'pay')!.body).toMatchObject({ lang: 'en' });
  });
});

describe('the invoice being made (client-page-10, 30)', () => {
  const bill = { lines: [{ description: 'Huile', qty: 1, unit_cents: 10000 }, { description: 'Rabais', qty: 1, unit_cents: 2000, kind: 'discount' }],
    subtotal_cents: 8000, tps_cents: 400, tvq_cents: 798, total_cents: 9198 };
  it('a draft before the visit: its lines are listed, so they add up to the total shown', async () => {
    server = () => job({ items: [{ id: 'a', description: 'Huile', qty: 1, unit_cents: 10000, status: 'planned' }], bill, expected: { subtotal: 8000, tps: 400, tvq: 798, total: 9198 } });
    await open();
    expect(sp(q('client-bill')[0].textContent)).toContain('Rabais');
    expect(sp(q('client-expected')[0].textContent)).toBe('80,00 $ + tx');
    expect(q('client-pay')).toHaveLength(0);                                    // still no payment before the work
  });
  it('on site without card payment: no « Vous pouvez payer pendant les travaux »', async () => {
    server = () => job({ bill, expected: { subtotal: 8000, tps: 400, tvq: 798, total: 9198 }, pay: { available: false, amount_cents: 9198, kind: 'prepay', pending: false } }, { status: 'on_site' });
    await open();
    expect(sp(q('client-bill-lead')[0].textContent)).not.toContain('Vous pouvez payer');
    expect(q('client-pay')).toHaveLength(0);
  });
});

describe('a link the server refuses (x-deadcode-25)', () => {
  it('is no longer offered from the tracking page', async () => {
    localStorage.setItem('his.client.t', JSON.stringify({ token: TOKEN, at: Date.now(), day: '2026-11-20' }));
    server = () => { throw new ClientError('expired', 'Ce lien a expiré.'); };
    await open();
    expect(q('client-error-expired')).toHaveLength(1);
    expect(localStorage.getItem('his.client.t')).toBeNull();
  });
});

describe('coming back to the tab (client-page-16)', () => {
  it('reads the file again after a while away; a quick look away asks nothing', async () => {
    let status: JobView['job']['status'] = 'booked';
    server = () => job({}, { status });
    await open();
    expect(sp(q('client-status')[0].textContent)).toBe('Rendez-vous confirmé');
    const visible = () => act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await visible();
    await wait();
    expect(calls.filter((c) => c.action === 'view')).toHaveLength(1);          // just loaded: nothing asked
    const real = Date.now;
    const later = real() + 60000;
    vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      status = 'on_site';
      await visible();
      await wait(); await wait();
      expect(calls.filter((c) => c.action === 'view')).toHaveLength(2);
      expect(sp(q('client-status')[0].textContent)).toBe('Votre mécano est sur place');
    } finally { vi.restoreAllMocks(); }
  });
  it('an answer that arrives after a newer one is dropped', async () => {
    let release: (v: JobView) => void = () => undefined;
    let n = 0;
    server = (a) => {
      n += 1;
      if (a === 'sign') return new Promise<JobView>((r) => { release = r; });   // slow: answers last
      return n === 1 ? job() : signed(job());
    };
    await open();
    // the tap starts (the slow sign), then the page is read again and shows the signed estimate
    void act(async () => { q('client-sign-click')[0].click(); });
    await wait();
    const later = Date.now() + 60000;
    vi.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      await wait(); await wait();
      expect(q('client-signed')).toHaveLength(1);
      // the old answer of the sign (the unsigned estimate) arrives now: it must not bring the button back
      await act(async () => { release(job()); });
      await wait(); await wait();
      expect(q('client-signed')).toHaveLength(1);
      expect(q('client-sign-click')).toHaveLength(0);
    } finally { vi.restoreAllMocks(); }
  });
});
