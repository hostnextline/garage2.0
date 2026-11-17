/* « Modifier la facture » refused while a payment of the invoice waits on the phone (argent-app-03): the words are the
   dictionaries' `errors.payment_waiting` as soon as they have it, in both languages; the two sentences in api.ts only
   stand in while the key is missing, so they can never hide other words written there later (app-data-r2-2).
   The key is put in the dictionaries here before anything reads it (each test file has its own copy of the modules). */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { FakeServer, clientFor } from './testkit';
import { startSync, stopSync, net, syncOptions } from './sync';
import { setNet } from './net';
import { addPayment, reopenInvoice } from './api';
import { fr } from '../i18n/fr';
import { en } from '../i18n/en';
import { lang, type Lang } from '../lib/i18n';
import { errorMessage } from '../lib/errors';

const WORDS: Record<Lang, string> = { fr: 'Mots du dictionnaire : un paiement attend.', en: 'Dictionary words: a payment waits.' };
const dict = (l: Lang) => (l === 'fr' ? fr.errors : en.errors) as unknown as Record<string, unknown>;
const before: Record<Lang, unknown> = { fr: undefined, en: undefined };

beforeAll(() => {
  for (const l of ['fr', 'en'] as const) { before[l] = dict(l).payment_waiting; dict(l).payment_waiting = WORDS[l]; }
});
afterAll(() => {
  for (const l of ['fr', 'en'] as const) { if (before[l] === undefined) delete dict(l).payment_waiting; else dict(l).payment_waiting = before[l]; }
});
afterEach(() => stopSync());

describe('the refusal of « Modifier la facture » while a payment waits speaks the dictionaries\' words (app-data-r2-2)', () => {
  it('in French and in English, on the refusal itself and through errorMessage', async () => {
    const srv = new FakeServer();
    srv.put('jobs', { id: 'j1', customer_id: 'c1', status: 'on_site', day: '2026-11-16' });
    srv.put('invoices', { id: 'v1', job_id: 'j1', customer_id: 'c1', number: 42, status: 'issued', total_cents: 20000 });
    syncOptions.realtime = false;
    setNet({ online: true, session: 'ok', storage: 'ok', stuck: null, pending: 0, failed: [], ready: false, firstPull: 'no' });
    const uid = '00000000-0000-4000-d000-000000000001';
    await startSync(clientFor(srv, uid), uid);
    const end = Date.now() + 4000;
    while (!net.value.ready) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
    srv.offline = true;
    setNet({ online: false });
    expect((await addPayment('v1', 20000, 'cash', null, 'j1')).queued).toBe(true);
    const was = lang.value;
    try {
      for (const l of ['fr', 'en'] as const) {
        lang.value = l;
        const err = await reopenInvoice('v1').then(() => null, (e: unknown) => e);
        expect(err).toMatchObject({ kind: 'refusal', hint: 'payment_waiting', message: WORDS[l] });
        expect(errorMessage(err)).toBe(WORDS[l]);
      }
    } finally { lang.value = was; }
  });
});
