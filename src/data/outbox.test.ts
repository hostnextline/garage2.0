/* The queue itself (outbox.ts, rescue.ts) on fake-indexeddb: what a second tab's reload and the rescue copy keep. */
import { describe, it, expect } from 'vitest';
import { Outbox } from './outbox';
import { openLocal, type OutboxEntry } from './local';
import { saveRescue, readRescue } from './rescue';

let n = 0;
const nextUid = () => `00000000-0000-4000-c000-${String(++n).padStart(12, '0')}`;
const entry = (op: string, p: Partial<OutboxEntry> = {}): OutboxEntry => ({ op, kind: 'insert', table: 'customers', id: op, values: { id: op }, at: new Date().toISOString(), tries: 0, state: 'pending', v: 2, sent: 0, ...p });
const queue = (uid: string) => new Outbox(openLocal(uid), uid, () => undefined, () => undefined);

describe('another tab says the queue changed while this tab is keeping a change (two-tab reload drop)', () => {
  it('a change still being written when the listing was read stays in this tab\'s queue', async () => {
    const uid = nextUid();
    const ob = queue(uid);
    const since = ob.mark();
    const listed = await ob.db!.listEntries();   // read before the change below was kept
    const it = ob.add(entry('a'), true);
    await ob.load(listed, [], since);
    expect(ob.items.map((i) => i.e.op)).toEqual(['a']);
    await it.ready;
    expect(ob.pending().map((i) => i.e.op)).toEqual(['a']);
    ob.db!.close();
  });
  it('a change kept just after the listing was read stays too, and stays after the next reload', async () => {
    const uid = nextUid();
    const ob = queue(uid);
    await ob.add(entry('a'), true).ready;
    const since = ob.mark();
    const listed = await ob.db!.listEntries();
    await ob.add(entry('b'), true).ready;
    await ob.load(listed, [], since);
    expect(ob.items.map((i) => i.e.op)).toEqual(['a', 'b']);
    await ob.load(await ob.db!.listEntries(), [], ob.mark());
    expect(ob.items.map((i) => i.e.op)).toEqual(['a', 'b']);
    ob.db!.close();
  });
  it('an edit merged into a new row is not undone on screen by a listing read before the merge was written', async () => {
    const uid = nextUid();
    const ob = queue(uid);
    await ob.add(entry('c', { values: { id: 'c', first_name: 'A' } }), true).ready;
    const listed = await ob.db!.listEntries();
    expect(ob.merge('customers', 'c', { phone: '514' }, undefined, () => undefined)).toBe(true);
    await ob.load(listed, [], ob.mark());
    expect(ob.items[0].e.values).toMatchObject({ first_name: 'A', phone: '514' });
    await ob.items[0].ready;
    await ob.load(await ob.db!.listEntries(), [], ob.mark());
    expect(ob.items[0].e.values).toMatchObject({ first_name: 'A', phone: '514' });
    ob.db!.close();
  });
  it('a change made before the mark whose write has not landed yet stays (a slow or retried write)', async () => {
    const uid = nextUid();
    const ob = queue(uid);
    const add = ob.db!.addEntry;
    let land!: () => void;
    const landed = new Promise<void>((r) => { land = r; });
    ob.db!.addEntry = async (e) => { await landed; return add(e); };
    const it = ob.add(entry('slow'), true);
    const since = ob.mark();   // the change is older than the mark…
    await ob.load(await ob.db!.listEntries(), [], since);   // …but the listing cannot have it
    expect(ob.items).toEqual([it]);
    land();
    await it.ready;
    expect(ob.pending().map((i) => i.e.op)).toEqual(['slow']);
    expect(it.e.seq).toBeGreaterThan(0);
    await ob.load(await ob.db!.listEntries(), [], ob.mark());
    expect(ob.items).toEqual([it]);
    ob.db!.close();
  });
  it('a change written whose answer is not back yet is kept once, at its place in the listing, as the same item', async () => {
    const uid = nextUid();
    const ob = queue(uid);
    await ob.add(entry('first'), true).ready;
    const add = ob.db!.addEntry;
    let answer!: () => void;
    const back = new Promise<void>((r) => { answer = r; });
    let wrote = false;
    ob.db!.addEntry = async (e) => { const seq = await add(e); wrote = true; await back; return seq; };
    const it = ob.add(entry('second'), true);
    await new Promise<void>((r) => { const t = setInterval(() => { if (wrote) { clearInterval(t); r(); } }, 5); });
    const listed = await ob.db!.listEntries();
    expect(listed.map((e) => e.op)).toEqual(['first', 'second']);
    await ob.load(listed, [], ob.mark());
    expect(ob.items.map((i) => i.e.op)).toEqual(['first', 'second']);
    expect(ob.items[1]).toBe(it);
    answer();
    await it.ready;
    expect(ob.items.map((i) => i.e.seq)).toEqual(listed.map((e) => e.seq));
    ob.db!.close();
  });
  it('a change another tab finished (gone from the listing, made before the mark) leaves this tab\'s queue', async () => {
    const uid = nextUid();
    const ob = queue(uid);
    const it = ob.add(entry('d'), true);
    await it.ready;
    await ob.db!.mutateEntry(it.e.seq!, () => ({ del: true, result: null }));
    await ob.load(await ob.db!.listEntries(), [], ob.mark());
    expect(ob.items.length).toBe(0);
    ob.db!.close();
  });
});

describe('the rescue copy keeps the head of the queue, never a queue with a hole (rescue-order gap)', () => {
  it('after an entry too big to keep, the later ones are not kept either', () => {
    const uid = nextUid();
    const signature = entry('sig', { table: 'attachments', values: { id: 'sig', data: 'x'.repeat(150_000) } });
    const step = entry('waiver', { kind: 'rpc', rpc: 'job_step', args: { p_job: 'j1', p_action: 'waiver', p_data: { attachment_id: 'sig' } } });
    const kept = saveRescue(uid, [entry('before'), signature, step]);
    expect([...kept]).toEqual(['before']);
    expect(readRescue(uid).map((e) => e.op)).toEqual(['before']);
  });
  it('everything that fits is kept, in order', () => {
    const uid = nextUid();
    const kept = saveRescue(uid, [entry('a'), entry('b'), entry('c')]);
    expect([...kept]).toEqual(['a', 'b', 'c']);
    expect(readRescue(uid).map((e) => e.op)).toEqual(['a', 'b', 'c']);
  });
});

describe('an edit asked while the queue\'s head is being marked (merge-fallback-order)', () => {
  it('is its own change, at its place: never merged into an entry that is leaving', async () => {
    const uid = nextUid();
    const ob = queue(uid);
    const it = ob.add(entry('h', { values: { id: 'h', first_name: 'A' } }), true);
    await it.ready;
    const marking = ob.attempt(it);   // the sender picked it: the mark is on its way to IndexedDB
    expect(ob.merge('customers', 'h', { phone: '514' }, undefined, () => { throw new Error('never added at the end later'); })).toBe(false);
    await marking;
    expect(ob.items[0].e.values).toEqual({ id: 'h', first_name: 'A' });
    ob.db!.close();
  });
});
