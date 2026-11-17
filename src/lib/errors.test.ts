import { describe, it, expect, beforeEach } from 'vitest';
import { classify, isNetworkError, errorMessage, Refused, AppError, NO_SESSION, OTHER_ACCOUNT } from './errors';
import { lang } from './i18n';

const kind = (e: unknown, status?: number) => { const c = classify(e, status); return `${c.kind}/${c.sub}`; };

describe('classify: from the HTTP status and the code, never from the server\'s sentence', () => {
  it('server trouble is « try again », not a refusal (core-data-11, x-sync-04)', () => {
    // a PostgREST error object has no status of its own: the transport passes the response's
    expect(kind({ message: 'An invalid response was received from the upstream server' }, 502)).toBe('network/server');
    expect(kind({ message: '<html>Bad gateway</html>' }, 504)).toBe('network/server');
    expect(kind({ code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, 503)).toBe('network/server');
    for (const code of ['PGRST000', 'PGRST001', 'PGRST003', '57014', '53300', '53100', '40001', '40P01', '55P03', '08006', '57P01'])
      expect(kind({ code, message: 'whatever' })).toBe('network/server');
    expect(kind({ message: 'slow down' }, 429)).toBe('network/busy');
    expect(kind({ message: '' }, 408)).toBe('network/server');
  });
  it('no signal and our own timeout', () => {
    expect(kind({ message: 'TypeError: Failed to fetch', code: '' }, 0)).toBe('network/offline');
    expect(kind(new TypeError('Load failed'))).toBe('network/offline');
    expect(kind({ message: 'AbortError: The user aborted a request.', hint: 'Request was aborted (timeout or manual cancellation)', code: '' })).toBe('network/offline');
    expect(kind(Object.assign(new Error('timeout'), { code: 'timeout' }))).toBe('network/timeout');
  });
  it('a request that carried no session is not a refusal (core-data-09)', () => {
    expect(kind({ code: NO_SESSION, message: 'no session' }, 401)).toBe('auth/none');
    expect(kind({ code: OTHER_ACCOUNT, message: 'other account' }, 401)).toBe('auth/account');
    expect(kind({ code: 'PGRST301', message: 'JWT expired' })).toBe('auth/expired');
    expect(kind({ code: '42501', message: 'permission denied' }, 401)).toBe('auth/expired');
  });
  it('an app older or newer than the server', () => {
    expect(kind({ code: 'PGRST202', message: 'Could not find the function public.x' }, 404)).toBe('bug/update');
    expect(kind({ code: '42883', message: 'function does not exist' })).toBe('bug/update');
  });
  it('real refusals', () => {
    expect(kind({ code: 'P0001', hint: 'block_full', message: 'Ce bloc est complet.' }, 400)).toBe('refusal/rule');
    expect(kind({ ok: false, code: 'not_allowed', error: 'Cette job n’est pas à toi.' })).toBe('refusal/rule');
    expect(kind({ code: '42501', message: 'permission denied for table jobs' }, 403)).toBe('refusal/rights');
    expect(kind({ code: '23505', message: 'duplicate key value' }, 409)).toBe('refusal/duplicate');
    expect(kind({ code: '23514', message: 'violates check constraint' }, 400)).toBe('refusal/invalid');
    expect(kind(new Refused('preview', 'Lecture seule'))).toBe('refusal/preview');
  });
  it('anything else is ours, never mistaken for no signal', () => {
    expect(kind(new Error('not started'))).toBe('bug/unknown');
    expect(isNetworkError(new Error('not started'))).toBe(false);
  });
  it('an AppError stays itself', () => {
    const e = new AppError('network', 'timeout', 'x');
    expect(classify(e)).toBe(e);
  });
});

describe('isNetworkError keeps answering what the screens asked before', () => {
  it('true for every case it said true for', () => {
    expect(isNetworkError({ code: 'timeout' })).toBe(true);
    expect(isNetworkError({ code: '40P01' })).toBe(true);
    expect(isNetworkError({ status: 0 })).toBe(true);
    expect(isNetworkError({ status: 503, message: 'x' })).toBe(true);
    expect(isNetworkError({ message: 'TypeError: NetworkError when attempting to fetch resource.' })).toBe(true);
  });
  it('false for refusals and for a permission sentence that mentions the network', () => {
    expect(isNetworkError({ code: 'P0001', hint: 'past', message: 'Ce jour est passé.' })).toBe(false);
    expect(isNetworkError({ message: 'new row violates row-level security policy (network)' })).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('errorMessage: same words for the same errors', () => {
  beforeEach(() => { lang.value = 'fr'; });
  it('our own refusals: the server\'s sentence in French, the dictionary in English', () => {
    const e = { code: 'P0001', hint: 'preview', message: 'Phrase du serveur' };
    expect(errorMessage(e)).toBe('Phrase du serveur');
    lang.value = 'en';
    expect(errorMessage(e)).not.toBe('Phrase du serveur');
    expect(errorMessage(new Refused('preview', 'Lecture seule'))).not.toBe('Lecture seule');
  });
  it('no signal → the network sentence; the server unwell → « réessaie dans un moment »', () => {
    expect(errorMessage({ message: 'TypeError: Failed to fetch' })).toMatch(/connexion/i);
    expect(errorMessage({ code: 'PGRST002', message: 'schema cache' })).toMatch(/serveur ne répond pas/i);
  });
  it('a foreign hint (PostgREST help text) is not taken for one of our codes (i18n-20)', () => {
    const e = { code: '22P02', hint: 'Perhaps you meant to reference the column "x".', message: 'invalid input syntax' };
    expect(errorMessage(e)).toBe('Quelque chose n’a pas marché : invalid input syntax');
  });
  it('the transport\'s « server » code shows the dictionary, not « HTTP 504 » (i18n-02)', () => {
    expect(errorMessage({ ok: false, code: 'server', error: 'HTTP 504' })).toMatch(/serveur ne répond pas/i);
  });
  it('no dangling colon when there is nothing to say (i18n-20)', () => {
    expect(errorMessage(null)).toBe('Quelque chose n’a pas marché');
    expect(errorMessage({})).toBe('Quelque chose n’a pas marché');
  });
  it('permission: the French sentence when the server wrote one, else « pas accès »', () => {
    expect(errorMessage({ code: '42501', message: 'Changement refusé : tu n’as pas accès' })).toBe('Changement refusé : tu n’as pas accès');
    expect(errorMessage({ code: '42501', message: 'permission denied for table jobs' })).toMatch(/pas accès/);
  });
  it('a string is shown as it is', () => { expect(errorMessage('Déjà fait')).toBe('Déjà fait'); });
});
