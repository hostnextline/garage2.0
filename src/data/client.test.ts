import { describe, it, expect, afterEach } from 'vitest';
import { guardedFetch, expectAccount, ask } from './client';
import { jwt } from './testkit';
import { SUPABASE_URL, SUPABASE_KEY } from '../lib/config';
import { NO_SESSION, OTHER_ACCOUNT } from '../lib/errors';

const REST = `${SUPABASE_URL}/rest/v1/jobs?select=*`;
let sent: string[] = [];
const ok = async (input: RequestInfo | URL) => { sent.push(String(input)); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };

afterEach(() => { sent = []; expectAccount(null); });

describe('the door every request goes through (core-data-09)', () => {
  it('a database request with the public key in place of a session never leaves', async () => {
    (globalThis as { fetch: unknown }).fetch = ok;
    const r = await guardedFetch(REST, { headers: { Authorization: `Bearer ${SUPABASE_KEY}` } });
    expect(r.status).toBe(401);
    expect((await r.json()).code).toBe(NO_SESSION);
    expect(sent).toEqual([]);
  });
  it('another account\'s session never sends this account\'s changes', async () => {
    (globalThis as { fetch: unknown }).fetch = ok;
    expectAccount('00000000-0000-4000-8000-00000000000a');
    const r = await guardedFetch(REST, { headers: { Authorization: `Bearer ${jwt('00000000-0000-4000-8000-00000000000b')}` } });
    expect((await r.json()).code).toBe(OTHER_ACCOUNT);
    expect(sent).toEqual([]);
  });
  it('the right session goes through; server functions and the demo are not concerned', async () => {
    (globalThis as { fetch: unknown }).fetch = ok;
    expectAccount('00000000-0000-4000-8000-00000000000a');
    expect((await guardedFetch(REST, { headers: { Authorization: `Bearer ${jwt('00000000-0000-4000-8000-00000000000a')}` } })).status).toBe(200);
    expect((await guardedFetch(`${SUPABASE_URL}/functions/v1/team`, { headers: { Authorization: `Bearer ${SUPABASE_KEY}` } })).status).toBe(200);
    expectAccount('demo-x', false);
    expect((await guardedFetch(REST, { headers: { Authorization: `Bearer ${SUPABASE_KEY}` } })).status).toBe(200);
    expect(sent.length).toBe(3);
  });
});

describe('a time limit that really cancels the request (core-data-26)', () => {
  it('the request is aborted and the error says « try again »', async () => {
    let signal: AbortSignal | undefined;
    const hanging = (s: AbortSignal) => { signal = s; return new Promise<{ data: unknown; error: unknown }>((res) => s.addEventListener('abort', () => res({ data: null, error: { message: 'AbortError: aborted', code: '' } }))); };
    await expect(ask(hanging, 30)).rejects.toMatchObject({ kind: 'network', sub: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });
  it('an answer carries its HTTP status into the error\'s kind', async () => {
    await expect(ask(async () => ({ data: null, error: { message: 'Bad gateway' }, status: 502 }), 1000)).rejects.toMatchObject({ kind: 'network', sub: 'server', status: 502 });
    await expect(ask(async () => ({ data: null, error: { code: 'P0001', hint: 'past', message: 'Ce jour est passé.' }, status: 400 }), 1000)).rejects.toMatchObject({ kind: 'refusal', hint: 'past' });
  });
});
