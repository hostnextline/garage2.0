import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReceiptQueue, receiptImage, openableUrl, tryTimeout, type QueueDeps, type WaitingPhoto, type ReceiptPhoto } from './receipts';

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
  it('a refusal is thrown to the person at once, and a waiting photo refused later is dropped', async () => {
    const s = fakeServer();
    const q = createReceiptQueue({ ...s.deps, upload: async () => { throw Object.assign(new Error('violates row-level security policy'), { code: '42501' }); } });
    await expect(q.send(photo('p3'), 'e3')).rejects.toThrow(/row-level/);
    const q2 = createReceiptQueue(s.deps);
    await q2.send(photo('p4'), 'e4');
    const q3 = createReceiptQueue({ ...s.deps, upload: async () => { throw Object.assign(new Error('too big'), { code: '23514' }); } });
    await q3.resume();
    expect(s.refusals.length).toBe(1);
    expect(s.kept.size).toBe(0);
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
