/* What the app asks the server for « Envoyer les heures aux clients » (Part 28, REARRANGE.md §1.5, §1.6-1): the list (a
   read, never kept), the day's button (a NEW op each call, the ids shown, `again` only when given), the marks (never kept
   on the phone), and every answer read defensively. callRpc / callFn pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpc = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown>; opts: Record<string, unknown> }[], answer: null as unknown }));
const fn = vi.hoisted(() => ({ calls: [] as { name: string; body: Record<string, unknown> }[], answer: null as unknown, fail: null as unknown }));
vi.mock('./sync', async (orig) => {
  const real = await orig<typeof import('./sync')>();
  return { ...real, callRpc: async (name: string, args: Record<string, unknown>, opts: Record<string, unknown> = {}) => { rpc.calls.push({ name, args, opts }); return { queued: false, data: rpc.answer }; } };
});
vi.mock('./auth', async (orig) => {
  const real = await orig<typeof import('./auth')>();
  return { ...real, callFn: async (name: string, body: Record<string, unknown>) => { fn.calls.push({ name, body }); if (fn.fail) throw fn.fail; return fn.answer; } };
});
import { tellList, tellRowsOf, sendDay, dayAnswerOf, tellMark } from './tell';
import { viewAs } from './auth';
import type { Access } from './types';

beforeEach(() => { rpc.calls.length = 0; fn.calls.length = 0; rpc.answer = null; fn.answer = { ok: true, status: 'done' }; fn.fail = null; viewAs.value = null; });

describe('tell_list', () => {
  it('asked as a read (noOp: never kept, no op id) with the day; rows read defensively', async () => {
    rpc.answer = [
      { id: 'j1', number: 41, customer_id: 'c1', state: 'changed', kind: 'moved', told: { day: '2026-11-24', start: 540, end: 780, at: '2026-11-20T10:00:00Z', how: 'sms' },
        now: { day: '2026-11-25', start: 780, end: 1020, rewin: true }, phone_ok: true, sms_ok: true, kind_on: true },
      { id: 'j2', number: 42, customer_id: null, state: 'new', kind: 'booking', told: null, now: { day: '2026-11-25', start: null, end: null }, phone_ok: false, sms_ok: false, kind_on: false },
      { id: 'j3', number: 43, state: 'drift', kind: null, now: { day: '2026-11-25', start: 540, end: 780 } },
      { id: '', state: 'new', now: { day: '2026-11-25' } }, { id: 'j5', state: 'ok', now: { day: '2026-11-25' } }, { id: 'j6', state: 'new' }, null, 'x'
    ];
    const rows = await tellList('2026-11-25');
    expect(rpc.calls).toEqual([{ name: 'tell_list', args: { p_day: '2026-11-25' }, opts: { noOp: true } }]);
    expect(rows.map((r) => r.id)).toEqual(['j1', 'j2', 'j3']);
    expect(rows[0]).toEqual({ id: 'j1', number: 41, customer_id: 'c1', state: 'changed', kind: 'moved',
      told: { day: '2026-11-24', start: 540, end: 780, at: '2026-11-20T10:00:00Z', how: 'sms' }, now: { day: '2026-11-25', start: 780, end: 1020, rewin: true }, phone_ok: true, sms_ok: true, kind_on: true });
    expect(rows[1]).toMatchObject({ customer_id: null, told: null, now: { start: null, end: null, rewin: false }, phone_ok: false, sms_ok: false, kind_on: false });
    // a missing sms_ok / kind_on reads as « yes » (only false says no), a missing phone_ok as « no »
    expect(rows[2]).toMatchObject({ kind: null, phone_ok: false, sms_ok: true, kind_on: true, customer_id: null });
    expect(tellRowsOf(null)).toEqual([]);
    expect(tellRowsOf({ rows: [] })).toEqual([]);
  });
});

describe('notify { action: "day" }', () => {
  it('a NEW op each call, the ids shown, `again` only when given, the app\'s address', async () => {
    await sendDay('2026-11-25', ['j1', 'j2']);
    await sendDay('2026-11-25', ['j2'], ['j2']);
    expect(fn.calls.map((c) => c.name)).toEqual(['notify', 'notify']);
    const [a, b] = fn.calls.map((c) => c.body);
    expect(a).toMatchObject({ action: 'day', day: '2026-11-25', only: ['j1', 'j2'] });
    expect(a.again).toBeUndefined();
    expect(typeof a.base).toBe('string');
    expect(b).toMatchObject({ only: ['j2'], again: ['j2'] });
    expect(typeof a.op).toBe('string');
    expect(a.op).not.toBe(b.op);
  });
  it('the answer read defensively; a refusal is ok false with its code; a lost answer throws (never asked again here)', async () => {
    fn.answer = { ok: true, status: 'done', day: '2026-11-25', sent: ['j1', 7], maybe: ['j2'], already: [], busy: ['j9'], gone: [], left: ['j4'],
      quiet: [{ id: 'j5', phone: '5145550101', why: 'sms_ok' }, { why: 'x' }], no_phone: ['j6'],
      failed: [{ id: 'j7', error: 'Le service de textos ne répond pas.', phone: '5145550102', told: { day: '2026-11-25', start: 780, end: 1020 }, kind: 'moved' }],
      by_hand: [{ id: 'j8', phone: null, message: 'Bonjour…', link: 'https://x', told: { day: '2026-11-25', start: null, end: null }, kind: 'window' }] };
    const r = await sendDay('2026-11-25', ['j1']);
    expect(r).toMatchObject({ ok: true, sent: ['j1'], maybe: ['j2'], busy: ['j9'], left: ['j4'], no_phone: ['j6'] });
    expect(r.quiet).toEqual([{ id: 'j5', phone: '5145550101', why: 'sms_ok' }]);
    expect(r.failed[0]).toEqual({ id: 'j7', error: 'Le service de textos ne répond pas.', phone: '5145550102', told: { day: '2026-11-25', start: 780, end: 1020 }, kind: 'moved' });
    expect(r.by_hand[0]).toMatchObject({ id: 'j8', kind: 'window', told: { day: '2026-11-25', start: null, end: null } });
    fn.answer = { ok: false, code: 'not_allowed', error: 'Seuls le propriétaire et le bureau envoient les heures aux clients.' };
    expect(await sendDay('2026-11-25', ['j1'])).toMatchObject({ ok: false, code: 'not_allowed', sent: [], left: [] });
    expect(dayAnswerOf(undefined)).toMatchObject({ ok: true, sent: [], failed: [] });
    fn.fail = Object.assign(new TypeError('Failed to fetch'), {});
    await expect(sendDay('2026-11-25', ['j1'])).rejects.toThrow();
  });
  it('« Voir l\'app comme… »: nothing is sent', async () => {
    viewAs.value = { id: 'x', owner: false, roles: ['office'], rights: { book: true } } as unknown as Access;
    await expect(sendDay('2026-11-25', ['j1'])).rejects.toMatchObject({ code: 'preview' });
    await expect(tellMark([{ id: 'j1', how: 'call', kind: 'moved', day: '2026-11-25', start: 780, end: 1020 }])).rejects.toMatchObject({ code: 'preview' });
    expect(fn.calls.length + rpc.calls.length).toBe(0);
  });
});

describe('tell_mark', () => {
  it('sent now (never kept on the phone), the marks as the server reads them; the answer read', async () => {
    rpc.answer = { ok: true, marked: ['j1'], changed: ['j2'], busy: [], rows: { jobs: [] } };
    const a = await tellMark([{ id: 'j1', how: 'call', kind: 'moved', day: '2026-11-25', start: 780, end: 1020 }, { id: 'j2', how: 'hand', kind: null, day: '2026-11-25', start: null, end: null }]);
    expect(rpc.calls[0]).toEqual({ name: 'tell_mark', args: { p_marks: [{ id: 'j1', how: 'call', kind: 'moved', day: '2026-11-25', start: 780, end: 1020 }, { id: 'j2', how: 'hand', kind: null, day: '2026-11-25', start: null, end: null }] }, opts: { queue: false } });
    expect(a).toEqual({ ok: true, marked: ['j1'], changed: ['j2'], busy: [] });
    rpc.answer = undefined;
    expect(await tellMark([{ id: 'j1', how: 'call', kind: null, day: 'd', start: null, end: null }])).toEqual({ ok: true, marked: [], changed: [], busy: [] });
  });
});
