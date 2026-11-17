/* A kept picture read back (loadAttachment): only plain pictures, and a failed read is not « no picture » (R106). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeServer, jwt } from './testkit';

let srv: FakeServer;
const uid = '00000000-0000-4000-d000-000000000001';
async function api() {
  vi.resetModules();
  // this device holds a session (the app's own client reads it at start)
  const session = { access_token: jwt(uid), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: uid, aud: 'authenticated', email: 's@x', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } };
  localStorage.setItem('his.auth', JSON.stringify(session));
  (globalThis as { fetch: unknown }).fetch = srv.fetch;
  return import('./api');
}
beforeEach(() => { srv = new FakeServer(); localStorage.clear(); });

describe('loadAttachment (R106, x-security-01)', () => {
  it('a signature kept as a PNG comes back as a picture', async () => {
    srv.put('attachments', { id: 'a1', mime: 'image/png', data: 'iVBORw0KGgo=' });
    const m = await api();
    expect(await m.loadAttachment('a1')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
  it('an SVG (or anything that is not a plain picture) is never shown', async () => {
    srv.put('attachments', { id: 'a2', mime: 'image/svg+xml', data: 'PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' });
    srv.put('attachments', { id: 'a3', mime: 'text/html', data: 'PGI+' });
    const m = await api();
    expect(await m.loadAttachment('a2')).toBeNull();
    expect(await m.loadAttachment('a3')).toBeNull();
  });
  it('no such picture: null', async () => {
    const m = await api();
    expect(await m.loadAttachment('nope')).toBeNull();
  });
  it('no signal, or the server unwell: the read throws (the screen says it could not load, not « nothing kept »)', async () => {
    srv.put('attachments', { id: 'a4', mime: 'image/png', data: 'iVBORw0KGgo=' });
    const m = await api();
    srv.offline = true;
    await expect(m.loadAttachment('a4')).rejects.toMatchObject({ kind: 'network' });
    srv.offline = false;
    srv.failNext((c) => c.table === 'attachments', 503, { code: 'PGRST002', message: 'schema cache' }, 20);
    await expect(m.loadAttachment('a4')).rejects.toMatchObject({ kind: 'network', sub: 'server' });
    // supabase-js tries a failed read again by itself for a few seconds before it answers (as before)
  }, 60000);
});
