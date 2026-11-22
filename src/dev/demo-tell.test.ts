/* The demo's « Envoyer les heures aux clients » (Part 28, REARRANGE.md §1.5, §1.6, U8): tell_list, tell_mark and the ONE
   notify (action 'day', and the single booking / window / moved through the lease, told written) answer like the
   server, with its rights. demo-extra/tell.ts, demo-extra/jobs.ts. */
import { describe, it, expect, beforeEach } from 'vitest';
import { rpcOf, fnOf, find, put, table, type DemoRow } from './fake-server';
import { loadDemo } from './demo';
import { ME, TRUCK } from './demo-data';
import { addDays, today } from '../lib/dates';

const D = addDays(today(), 3);
const call = (name: string, args: Record<string, unknown>) => rpcOf(name)!(args) as Record<string, unknown> & Record<string, unknown>;
const fn = (body: Record<string, unknown>) => fnOf('notify')!(body) as Record<string, unknown>;
const code = (f: () => unknown) => { try { f(); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
const as = (id: string) => { (globalThis as { __demoUser?: string }).__demoUser = id; };
/** a mechanic without « Réserver » (the demo's mechanics have it by their role) */
function mechanicWithoutBook() {
  const s = find('settings', '1')!;
  const rr = (s.role_rights || {}) as Record<string, Record<string, boolean>>;
  put('settings', { id: '1', role_rights: { ...rr, mechanic: { ...(rr.mechanic || {}), book: false } } });
  as(ME.saleh);
}
const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id).sort();
const told = { told_day: D, told_start: 480, told_end: 720, told_at: '2026-11-20T10:00:00-05:00', told_how: 'sms' };
function job(id: string, o: Record<string, unknown> = {}): DemoRow {
  return put('jobs', { id, number: 900 + table('jobs').length, customer_id: 'c-e4', truck_id: TRUCK.complet, day: D, block: 'am', status: 'booked', stop_order: 1, duration_min: 60,
    eta_min: 540, win_start: null, win_end: null, win_flex: false, confirm_sent_at: null, deleted_at: null, ...o });
}

beforeEach(() => {
  history.replaceState(null, '', '/?demo=owner');
  loadDemo(ME.owner);
  put('customers', { id: 'c-e4', first_name: 'Chloé', last_name: 'Gagnon', phone: '514 555-0177', sms_ok: true, lang: 'fr', deleted_at: null });
  put('customers', { id: 'c-e4b', first_name: 'Fanny', last_name: 'Côté', phone: null, sms_ok: true, lang: 'fr', deleted_at: null });
  // only this test's appointments on that day
  for (const j of table('jobs')) if (j.day === D) put('jobs', { id: j.id, deleted_at: '2026-11-01T00:00:00Z' });
});

describe('demo: the told install', () => {
  it('a coming appointment whose confirmation went is told its hours (install); one without stays never told', () => {
    const sent = table('jobs').filter((j) => !j.deleted_at && j.status === 'booked' && String(j.day) >= today() && j.confirm_sent_at);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((j) => j.told_how === 'install' && j.told_at === j.confirm_sent_at && j.told_day === j.day)).toBe(true);
    const never = table('jobs').filter((j) => !j.deleted_at && j.status === 'booked' && String(j.day) >= today() && !j.confirm_sent_at);
    expect(never.every((j) => j.told_at == null)).toBe(true);
  });
});

describe('demo: tell_list', () => {
  it('the due ones of the day (never told, changed; on the day they have and the day they were told), not the ones told', () => {
    job('a');                                             // never told → new / booking
    job('b', told);                                       // told 8 h à 12 h, still am → ok
    job('c', { ...told, block: 'pm' });                   // told the morning, now the afternoon → changed / moved
    job('d', { ...told, day: addDays(D, 1) });             // moved to the next day: on BOTH days' lists
    job('e', { customer_id: 'c-e4b' });                    // no cell: listed, phone_ok false
    const rows = call('tell_list', { p_day: D }) as unknown as { id: string; state: string; kind: string; phone_ok: boolean; now: { day: string } }[];
    expect(ids(rows)).toEqual(['a', 'c', 'd', 'e']);
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ state: 'new', kind: 'booking', phone_ok: true });
    expect(rows.find((r) => r.id === 'c')).toMatchObject({ state: 'changed', kind: 'moved' });
    expect(rows.find((r) => r.id === 'd')!.now.day).toBe(addDays(D, 1));
    expect(rows.find((r) => r.id === 'e')!.phone_ok).toBe(false);
    expect(ids(call('tell_list', { p_day: addDays(D, 1) }))).toEqual(['d']);
  });
  it('a mechanic without « Réserver » is refused', () => {
    mechanicWithoutBook();
    expect(code(() => call('tell_list', { p_day: D }))).toBe('not_allowed');
  });
});

describe('demo: notify { action: \'day\' }', () => {
  it('texts the due ones of `only` with the hours of tell_now and writes told; pressed again: already', () => {
    job('a'); job('c', { ...told, block: 'pm' }); job('b', told); job('x', { status: 'cancelled' });
    const before = table('messages').length;
    const r = fn({ action: 'day', day: D, only: ['a', 'b', 'c', 'x'], op: 'op-1' });
    expect(r).toMatchObject({ ok: true, status: 'done' });
    expect((r.sent as string[]).sort()).toEqual(['a', 'c']);
    expect(r.already).toEqual(['b']);
    expect(r.gone).toEqual(['x']);
    expect(find('jobs', 'c')).toMatchObject({ told_day: D, told_start: 720, told_end: 960, told_how: 'sms' });
    expect(find('jobs', 'a')!.told_how).toBe('sms');
    const texts = table('messages').slice(before);
    expect(texts.map((m) => m.kind).sort()).toEqual(['booking', 'moved']);
    const again = fn({ action: 'day', day: D, only: ['a', 'c'], op: 'op-2' });
    expect(again.sent).toEqual([]);
    expect((again.already as string[]).sort()).toEqual(['a', 'c']);
    expect(table('messages').length).toBe(before + 2);
  });
  it('texts not connected: each one handed back with its message and the hours it says; nothing told', () => {
    history.replaceState(null, '', '/?demo=owner&texts=off');
    job('c', { ...told, block: 'pm' });
    const r = fn({ action: 'day', day: D, only: ['c'], op: 'op-3' });
    const h = (r.by_hand as { id: string; message: string; told: unknown; kind: string }[])[0];
    expect(h).toMatchObject({ id: 'c', kind: 'moved', told: { day: D, start: 720, end: 960 } });
    expect(h.message).toContain('Chloé');
    expect(find('jobs', 'c')!.told_start).toBe(480);
  });
  it('« Ne veut pas de textos » and that kind switched off: quiet, nothing sent; a mechanic: not allowed', () => {
    put('customers', { id: 'c-e4', sms_ok: false });
    job('a');
    expect(fn({ action: 'day', day: D, only: ['a'], op: 'op-4' }).quiet).toEqual([{ id: 'a', phone: '514 555-0177', why: 'sms_ok' }]);
    expect(find('jobs', 'a')!.told_at ?? null).toBeNull();
    mechanicWithoutBook();
    expect(fn({ action: 'day', day: D, only: ['a'], op: 'op-5' })).toMatchObject({ ok: false, code: 'not_allowed' });
  });
});

describe('demo: the single texts through the lease', () => {
  it('« moved » after a change: sent once and told; again: already; resend: sent', () => {
    job('c', { ...told, block: 'pm' });
    expect(fn({ kind: 'moved', job_id: 'c', op: 'm1' }).status).toBe('sent');
    expect(find('jobs', 'c')).toMatchObject({ told_start: 720, told_end: 960, told_how: 'sms' });
    expect(fn({ kind: 'moved', job_id: 'c', op: 'm2' }).status).toBe('already');
    expect(fn({ kind: 'moved', job_id: 'c', op: 'm3', resend: true }).status).toBe('sent');
  });
  it('a booking text told him: the day’s button then has nothing for him; texts off: the answer says what it told', () => {
    job('a');
    expect(fn({ kind: 'booking', job_id: 'a', op: 'b1' }).status).toBe('sent');
    expect(find('jobs', 'a')).toMatchObject({ told_day: D, told_start: 480, told_end: 720 });
    expect(fn({ action: 'day', day: D, only: ['a'], op: 'b2' }).already).toEqual(['a']);
    history.replaceState(null, '', '/?demo=owner&texts=off');
    job('n');
    expect(fn({ kind: 'booking', job_id: 'n', op: 'b3' })).toMatchObject({ status: 'off', told: { day: D, start: 480, end: 720 }, kind: 'booking', job_id: 'n' });
  });
});

describe('demo: tell_mark', () => {
  it('the hours still the ones to tell → told (call / hand); else changed; one refused id = nothing written', () => {
    job('c', { ...told, block: 'pm' });
    job('a');
    const r = call('tell_mark', { p_marks: [{ id: 'c', how: 'call', kind: 'moved', day: D, start: 720, end: 960 }, { id: 'a', how: 'hand', kind: 'booking', day: D, start: 600, end: 700 }] });
    expect(r).toMatchObject({ ok: true, marked: ['c'], changed: ['a'] });
    expect(find('jobs', 'c')).toMatchObject({ told_how: 'call', told_start: 720, told_by: ME.owner });
    expect(find('jobs', 'a')!.told_at ?? null).toBeNull();
    // a mechanic without « Réserver »: « Je l'ai averti » refused; « C'est envoyé » on a job of his own truck: marked
    mechanicWithoutBook();
    expect(code(() => call('tell_mark', { p_marks: [{ id: 'a', how: 'call', kind: 'booking', day: D, start: 480, end: 720 }] }))).toBe('not_allowed');
    expect(call('tell_mark', { p_marks: [{ id: 'a', how: 'hand', kind: 'booking', day: D, start: 480, end: 720 }] })).toMatchObject({ marked: ['a'] });
  });
});
