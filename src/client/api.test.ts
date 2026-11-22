/* What the page keeps of the server's refusal: the code (words of its own), never the server's French sentence. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { callClient, ClientError } from './api';

function answer(status: number, data: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ status, json: async () => data })));
}
async function refusal(): Promise<ClientError> {
  try { await callClient('pay', 'tok-appointment-0123456789'); } catch (e) { return e as ClientError; }
  throw new Error('no refusal');
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('refusal codes of the « client » function (R11)', () => {
  it('502 pay_unavailable → code kept', async () => {
    answer(502, { ok: false, code: 'pay_unavailable', error: 'Le paiement par carte ne répond pas pour l’instant.' });
    const e = await refusal();
    expect(e).toBeInstanceOf(ClientError);
    expect(e.code).toBe('pay_unavailable');
  });
  it('409 closed → code kept', async () => {
    answer(409, { ok: false, code: 'closed', error: 'Ce rendez-vous est terminé.' });
    expect((await refusal()).code).toBe('closed');
  });
  it('409 pay_processing (a bank debit on its way) → code kept, not « server »', async () => {
    answer(409, { ok: false, code: 'pay_processing', error: 'Un paiement pour ce dossier est déjà en traitement.' });
    expect((await refusal()).code).toBe('pay_processing');
  });
  it('409 amount_changed keeps the current amount', async () => {
    answer(409, { ok: false, code: 'amount_changed', error: 'x', current_cents: 29891 });
    const e = await refusal();
    expect(e.code).toBe('amount_changed');
    expect(e.currentCents).toBe(29891);
  });
  it('a code the page does not know reads as « server »', async () => {
    answer(500, { ok: false, code: 'something_new', error: 'x' });
    expect((await refusal()).code).toBe('server');
  });
});
