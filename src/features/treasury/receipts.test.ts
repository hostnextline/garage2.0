import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceiptQueue, receiptImage, readAttachment, openableUrl, tryTimeout, uploadPhoto, SEND_MAX_MS, type QueueDeps, type WaitingPhoto, type ReceiptPhoto } from './receipts';
import { classify } from '../../lib/errors';
import { sb } from '../../data/auth';

const photo = (id: string): ReceiptPhoto => ({ id, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(4000), w: 10, h: 10 });
const offline = () => Object.assign(new Error('TypeError: Failed to fetch'), { code: '' });

function fakeServer() {
  const rows = new Set<string>();
  let open = 0, maxOpen = 0;
  let mode: 'down' | 'up' | 'hang' = 'down';
  const kept = new Map<string, WaitingPhoto>();
  const links: [string, string][] = [];
  const refusals: unknown[] = [];
  const deps: QueueDeps = {
    upload: (p, signal) => new Promise<void>((resolve, reject) => {
      open++; maxOpen = Math.max(maxOpen, open);
      const done = (f: () => void) => { open--; f(); };
      if (mode === 'down') return done(() => reject(offline()));
      if (mode === 'up') { rows.add(p.id); return done(resolve); }
      // the request never answers until it is aborted
      signal.addEventListener('abort', () => done(() => reject(Object.assign(new Error('AbortError: aborted'), { code: '' }))));
    }),
    link: (e, r) => links.push([e, r]),
    refused: (e) => refusals.push(e),
    keep: { put: async (p) => { kept.set(p.id, p); }, remove: async (id) => { kept.delete(id); }, all: async () => [...kept.values()] },
    uid: () => 'u1'
  };
  return { deps, rows, kept, links, refusals, set: (m: typeof mode) => { mode = m; }, get maxOpen() { return maxOpen; } };
}

describe('receipt photos: out of the ordered outbox (bug 02)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('with no signal the photo waits on the phone and the expense goes without it; it is linked once it lands', async () => {
    const s = fakeServer();
    const q = createReceiptQueue(s.deps);
    expect(await q.send(photo('p1'), 'e1')).toEqual({ id: 'p1', queued: true });
    expect(s.kept.has('p1')).toBe(true);
    expect(q.picture('p1')).toMatch(/^data:image\/jpeg/);
    s.set('up');
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.rows.has('p1')).toBe(true);
    expect(s.links).toEqual([['e1', 'p1']]);
    expect(s.kept.size).toBe(0);
    expect(q.size).toBe(0);
  });
  it('a request that never answers is stopped, and tried again with the same id, one at a time', async () => {
    const s = fakeServer();
    s.set('hang');
    const q = createReceiptQueue(s.deps);
    const sent = q.send(photo('p1'), 'e1');
    await vi.advanceTimersByTimeAsync(tryTimeout(photo('p1').dataUrl));
    expect(await sent).toEqual({ id: 'p1', queued: true });
    await vi.advanceTimersByTimeAsync(10000 + tryTimeout(photo('p1').dataUrl));
    expect(s.maxOpen).toBe(1);
    s.set('up');
    await vi.advanceTimersByTimeAsync(60000);
    expect([...s.rows]).toEqual(['p1']);
    expect(s.links).toEqual([['e1', 'p1']]);
  });
  it('a send with signal goes straight away and keeps nothing', async () => {
    const s = fakeServer();
    s.set('up');
    const q = createReceiptQueue(s.deps);
    expect(await q.send(photo('p2'), 'e2')).toEqual({ id: 'p2', queued: false });
    expect(s.kept.size).toBe(0);
    expect(s.links).toEqual([]);
  });
  it('a refusal is thrown to the person at once; a waiting photo refused later is KEPT, marked, told once, not tried again by itself (review TR-1)', async () => {
    const s = fakeServer();
    const q = createReceiptQueue({ ...s.deps, upload: async () => { throw Object.assign(new Error('violates row-level security policy'), { code: '42501' }); } });
    await expect(q.send(photo('p3'), 'e3')).rejects.toThrow(/row-level/);
    const q2 = createReceiptQueue(s.deps);
    await q2.send(photo('p4'), 'e4');
    let tries = 0;
    const q3 = createReceiptQueue({ ...s.deps, upload: async () => { tries++; throw Object.assign(new Error('too big'), { code: '23514' }); } });
    await q3.resume();
    expect(s.refusals.length).toBe(1);
    expect(s.kept.get('p4')?.failed).toBe(true);
    expect(q3.waitingFor('e4')?.failed).toBe(true);
    expect(q3.picture('p4')).toMatch(/^data:image\/jpeg/);
    await vi.advanceTimersByTimeAsync(700000);
    await q3.drain();
    expect(tries).toBe(1);
    expect(s.refusals.length).toBe(1);
    // a later visit reads it back as refused: still not tried by itself
    const s4 = { ...s.deps, upload: async () => { tries++; } };
    const q4 = createReceiptQueue(s4);
    await q4.resume();
    expect(tries).toBe(1);
    // the person saves the expense again: one new try, and it lands
    await q4.retry('p4');
    await vi.advanceTimersByTimeAsync(0);
    expect(tries).toBe(2);
    expect(s.links).toEqual([['e4', 'p4']]);
    expect(s.kept.size).toBe(0);
  });
  it('an expired sign-in (a night with no signal) keeps the photo, renews the session and tries again (review TR-1)', async () => {
    const s = fakeServer();
    let expired = true;
    let renewed = 0;
    const q = createReceiptQueue({
      ...s.deps,
      reauth: async () => { renewed++; expired = false; return true; },
      upload: async (p, signal) => {
        if (expired) throw Object.assign(new Error('JWT expired'), { code: 'PGRST301', status: 401 });
        return s.deps.upload(p, signal);
      }
    });
    s.kept.set('p6', { ...photo('p6'), uid: 'u1', expenseId: 'e6' });
    s.set('up');
    await q.resume();
    expect(renewed).toBe(1);
    expect(s.refusals).toEqual([]);
    expect(s.kept.has('p6')).toBe(true);
    expect(s.kept.get('p6')?.failed).toBeFalsy();
    await vi.advanceTimersByTimeAsync(30000);
    expect(s.rows.has('p6')).toBe(true);
    expect(s.links).toEqual([['e6', 'p6']]);
  });
  it('an expired sign-in while saving in the sheet: the expense is saved, the photo waits (no refusal)', async () => {
    const s = fakeServer();
    const q = createReceiptQueue({ ...s.deps, reauth: async () => true, upload: async () => { throw Object.assign(new Error('JWT expired'), { code: 'PGRST301', status: 401 }); } });
    expect(await q.send(photo('p7'), 'e7')).toEqual({ id: 'p7', queued: true });
    expect(s.kept.has('p7')).toBe(true);
  });
  it('the try made while the person waits stops after 25 s, even for a big photo; the background try gets longer (review TR-2)', async () => {
    const s = fakeServer();
    s.set('hang');
    const q = createReceiptQueue(s.deps);
    const big: ReceiptPhoto = { id: 'big', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(600000), w: 1600, h: 1200 };
    expect(tryTimeout(big.dataUrl)).toBeGreaterThan(SEND_MAX_MS * 3);
    let answer: { id: string; queued: boolean } | null = null;
    void q.send(big, 'e8').then((a) => { answer = a; });
    await vi.advanceTimersByTimeAsync(SEND_MAX_MS - 1000);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(answer).toEqual({ id: 'big', queued: true });
    // the background try started after 10 s is still going at 25 s: it has the longer time
    await vi.advanceTimersByTimeAsync(10000 + SEND_MAX_MS + 1000);
    expect(s.maxOpen).toBe(1);
    expect(q.size).toBe(1);
  });
  it('one upload at a time: a save in the sheet pauses the background try, which goes on right after (review TR-6)', async () => {
    const s = fakeServer();
    s.set('hang');
    const q = createReceiptQueue(s.deps);
    await (async () => { const a = q.send(photo('old'), 'e1'); await vi.advanceTimersByTimeAsync(tryTimeout(photo('old').dataUrl)); await a; })();
    // the background try of « old » is running (and hangs)
    await vi.advanceTimersByTimeAsync(10000);
    s.set('up');
    expect(await q.send(photo('new'), 'e2')).toEqual({ id: 'new', queued: false });
    expect(s.maxOpen).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.rows.has('old')).toBe(true);
    expect(s.links).toEqual([['e1', 'old']]);
    expect(s.maxOpen).toBe(1);
  });
  it('photos kept by an earlier visit are sent, only in the session of the person who took them', async () => {
    const s = fakeServer();
    s.kept.set('mine', { ...photo('mine'), uid: 'u1', expenseId: 'e1' });
    s.kept.set('theirs', { ...photo('theirs'), uid: 'u2', expenseId: 'e9' });
    s.set('up');
    const q = createReceiptQueue(s.deps);
    await q.resume();
    expect([...s.rows]).toEqual(['mine']);
    expect(s.kept.has('theirs')).toBe(true);
  });
  it('a photo dropped by the person is never sent', async () => {
    const s = fakeServer();
    const q = createReceiptQueue(s.deps);
    await q.send(photo('p5'), 'e5');
    await q.drop('p5');
    s.set('up');
    await vi.advanceTimersByTimeAsync(700000);
    expect(s.rows.size).toBe(0);
    expect(q.waitingFor('e5')).toBeNull();
  });
});

describe('showing a receipt (x-security-01, bug 13)', () => {
  it('a picture is shown; anything else (SVG is shown as a picture only, HTML never) is « no longer available »', async () => {
    expect(await receiptImage('a1', async () => 'data:image/png;base64,iVBOR')).toBe('data:image/png;base64,iVBOR');
    expect(await receiptImage('a2', async () => 'data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(await receiptImage('a3', async () => null)).toBeNull();
  });
  it('with no network the read says so instead of « no longer available »', async () => {
    const was = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    try {
      await expect(receiptImage('a4', async () => null)).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      if (was) Object.defineProperty(window.navigator, 'onLine', was); else delete (window.navigator as { onLine?: boolean }).onLine;
    }
  });
  it('a request that fails on a weak signal the phone still thinks is fine: « needs the network », not « no longer available » (review TR-3)', async () => {
    const chain = (r: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => r }) }) });
    const spy = vi.spyOn(sb, 'from');
    try {
      spy.mockReturnValue(chain({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }) as never);
      await expect(readAttachment('a6')).rejects.toMatchObject({ message: /Failed to fetch/ });
      await expect(receiptImage('a6')).rejects.toMatchObject({ message: /Failed to fetch/ });
      spy.mockReturnValue(chain({ data: null, error: null }) as never);
      expect(await readAttachment('a7')).toBeNull();
      spy.mockReturnValue(chain({ data: { mime: 'image/png', data: 'iVBOR' }, error: null }) as never);
      expect(await receiptImage('a8')).toBe('data:image/png;base64,iVBOR');
    } finally { spy.mockRestore(); }
  });
  it('full size: only plain pictures, with the kind checked here (never an SVG or HTML document)', () => {
    const made: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => { made.push(b); return 'blob:x'; }) as typeof URL.createObjectURL;
    try {
      expect(openableUrl('data:image/jpeg;base64,/9j/')).toBe('blob:x');
      expect(made[0].type).toBe('image/jpeg');
      expect(openableUrl('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=')).toBeNull();
      expect(openableUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
      expect(made.length).toBe(1);
    } finally { URL.createObjectURL = orig; }
  });
});

describe('receipt photos: the real server’s answers (recorded on the local test stack by receipts.server-check.mjs)', () => {
  /** what supabase-js gave on the real stack, for the insert of receipts.ts */
  const REAL = {
    landed: { error: null, status: 201 },
    again: { error: { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "attachments_pkey"' }, status: 409 },
    noRight: { error: { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "attachments"' }, status: 403 },
    cutOff: { error: { code: '', details: '', hint: '', message: 'AbortError: This operation was aborted' }, status: 0 },
    noSignal: { error: { code: '', details: '', hint: '', message: 'TypeError: fetch failed' }, status: 0 },
    safari: { error: { code: '', details: '', hint: '', message: 'TypeError: Load failed' }, status: 0 },
    down: { error: { code: '', details: null, hint: null, message: '<html>502 Bad Gateway</html>' }, status: 502 }
  };
  const answer = (r: { error: unknown; status: number }) => {
    const insert = vi.fn(() => ({ abortSignal: vi.fn(async () => ({ ...r, error: r.error ? { ...(r.error as object) } : null })) }));
    return vi.spyOn(sb, 'from').mockReturnValue({ insert } as unknown as ReturnType<typeof sb.from>);
  };
  afterEach(() => { vi.restoreAllMocks(); });
  const kindOf = async (r: { error: unknown; status: number }) => {
    answer(r);
    try { await uploadPhoto(photo('p1'), new AbortController().signal); return 'sent'; } catch (e) { return classify(e).kind; }
  };
  it('landed, and the same photo again (its first answer lost) are both « sent »: stored once', async () => {
    expect(await kindOf(REAL.landed)).toBe('sent');
    expect(await kindOf(REAL.again)).toBe('sent');
  });
  it('cut off, no signal (Chrome, Safari) and a server that is down are « try later »: the photo waits on the phone', async () => {
    expect(await kindOf(REAL.cutOff)).toBe('network');
    expect(await kindOf(REAL.noSignal)).toBe('network');
    expect(await kindOf(REAL.safari)).toBe('network');
    expect(await kindOf(REAL.down)).toBe('network');
  });
  it('someone without « Trésorerie »: a refusal (the photo is kept, marked, the person is told)', async () => {
    expect(await kindOf(REAL.noRight)).toBe('refusal');
  });
  it('photographed with no signal, the real « fetch failed » answer: the expense goes, the photo is kept and lands later', async () => {
    vi.useFakeTimers();
    try {
      let r: { error: unknown; status: number } = REAL.noSignal;
      const insert = vi.fn(() => ({ abortSignal: vi.fn(async () => ({ ...r, error: r.error ? { ...(r.error as object) } : null })) }));
      vi.spyOn(sb, 'from').mockReturnValue({ insert } as unknown as ReturnType<typeof sb.from>);
      const kept = new Map<string, WaitingPhoto>();
      const links: [string, string][] = [];
      const q = createReceiptQueue({ upload: uploadPhoto, link: (e, id) => links.push([e, id]), refused: () => { throw new Error('not a refusal'); },
        keep: { put: async (p) => { kept.set(p.id, p); }, remove: async (id) => { kept.delete(id); }, all: async () => [...kept.values()] }, uid: () => 'u1' });
      expect(await q.send(photo('p1'), 'e1')).toEqual({ id: 'p1', queued: true });
      expect(kept.get('p1')?.failed).toBeFalsy();
      // the signal comes back; the first try had in fact landed and its answer was lost: « already there » = sent
      r = REAL.again;
      await vi.advanceTimersByTimeAsync(10000);
      expect(links).toEqual([['e1', 'p1']]);
      expect(kept.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
