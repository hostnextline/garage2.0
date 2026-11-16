import { describe, it, expect } from 'vitest';
import { sendVisit, type SendDeps } from './send';
import { visitJobs, kindFor, forcedJob, type VisitBase } from './visit';
import { outcome, withHint } from './outcome';
import { QC_TAXES } from '../../lib/money';
import type { BookInput } from '../../data/api';
import type { PlannedCar } from './draft';
import type { ItemDraft } from '../../domain/moment/logic';

const line = (description: string, duration_min = 45): ItemDraft => ({ kind: 'service', service_id: `s-${description}`, description, qty: 1, unit_cents: 8999, taxable: true, duration_min });
const car = (key: string, jobId: string, items: ItemDraft[], problem = ''): PlannedCar => ({ key, jobId, work: { jobId, items, dur: null, problem } });
const base: VisitBase = { customer_id: 'c-1', truck_id: null, notes: 'code 1234', address: '1 rue A', card_on_file: false, quote_id: 'q-1', source: 'quote', vehicle_kind: null };
const block = { day: '2026-11-18', block: 'am' as const };
const win = { day: '2026-11-18', block: 'day' as const, win_start: 600, win_end: 840 };

/** a pretend server: refuses a known id (`exists`, as book_job does), answers per car what the test says */
function server(answers: Record<string, 'ok' | 'queued' | 'forced' | string>, opts: { force?: boolean } = {}) {
  const seen = new Set<string>();
  const calls: BookInput[] = [];
  const asked: string[] = [];
  const refuse = (code: string) => Object.assign(new Error(code), { code: 'P0001', hint: code });
  const deps: SendDeps = {
    book: async (job) => {
      calls.push(job);
      if (seen.has(job.id!)) throw refuse('exists');
      const a = answers[job.vehicle_id ?? 'none'] ?? 'ok';
      if (a === 'queued') return { queued: true, id: job.id! };
      if (a === 'full' && !job.force) throw refuse('block_full');
      if (a !== 'ok' && a !== 'full' && a !== 'forced') throw refuse(a);
      seen.add(job.id!);
      return { queued: false, id: job.id!, data: { forced: !!job.force } };
    },
    walkIn: async (job) => ({ queued: answers.walkin === 'queued', id: job.id! }),
    askForce: async (msg) => { asked.push(msg); return !!opts.force; },
    message: (e) => (e as Error).message
  };
  return { deps, calls, asked };
}
const jobsOf = (cars: PlannedCar[], choice: typeof block | typeof win | null = block) => visitJobs(cars, base, { choice, taxes: QC_TAXES, carOf: (k) => (k.startsWith('v-') ? k : null) });

describe('the appointments of a visit', () => {
  it('one per car, its own id, its car, its minutes, its problem; the estimate with the first only; the moment for each', () => {
    const jobs = jobsOf([car('v-1', 'id-1', [line('Huile')], 'bruit'), car('call-x', 'id-2', [line('Pneus', 75)])]);
    expect(jobs.map((j) => [j.job.id, j.job.vehicle_id, j.job.duration_min, j.job.problem, j.job.quote_id, j.job.day, j.job.block, j.job.notes]))
      .toEqual([['id-1', 'v-1', 45, 'bruit', 'q-1', '2026-11-18', 'am', 'code 1234'], ['id-2', null, 75, null, null, '2026-11-18', 'am', 'code 1234']]);
    expect(jobs[0].lines[0]).toMatchObject({ description: 'Huile', status: 'planned' });
  });
  it('« Plages d’arrivée »: the window’s start for every car; « Réserver quand même »: no window asked', () => {
    const [j] = jobsOf([car('v-1', 'id-1', [line('Huile')])], win);
    expect(j.job).toMatchObject({ block: 'day', win_start: 600 });
    const f = forcedJob(j.job, win);
    expect(f).toMatchObject({ block: 'day', force: true });
    expect('win_start' in f).toBe(false);
  });
  it('the tire machine needed by one car of several: every car goes with the truck (booking-a-07)', () => {
    expect(kindFor(true, 2, null)).toBe('truck');
    expect(kindFor(true, 2, 'car')).toBe('truck');
    expect(kindFor(true, 1, 'car')).toBeNull();
    expect(kindFor(false, 2, 'car')).toBe('car');
  });
});

describe('sending a visit', () => {
  const two = () => jobsOf([car('v-1', 'id-1', [line('Huile')]), car('v-2', 'id-2', [line('Pneus')])]);
  it('every car booked, each with its own id', async () => {
    const s = server({});
    const r = await sendVisit(two(), { walkIn: false, choice: block, mayForce: true }, s.deps);
    expect(r.map((x) => x.status)).toEqual(['booked', 'booked']);
    expect(s.calls.map((c) => c.id)).toEqual(['id-1', 'id-2']);
  });
  it('a refusal stops the visit; the retry sends the cars left with their own ids, never `exists` (booking-a-02)', async () => {
    const s = server({ 'v-2': 'block_started' });
    const r1 = await sendVisit(two(), { walkIn: false, choice: block, mayForce: false }, s.deps);
    expect(r1.map((x) => x.status)).toEqual(['booked', 'refused']);
    const left = two().filter((j) => !r1.some((x) => x.status === 'booked' && x.key === j.key));
    s.deps.book = (async (job: BookInput) => ({ queued: false, id: job.id! })) as SendDeps['book'];
    const r2 = await sendVisit(left, { walkIn: false, choice: block, mayForce: false }, s.deps);
    expect(r2).toEqual([{ key: 'v-2', status: 'booked', id: 'id-2', forced: false, sentForced: false }]);
  });
  it('kept on the phone (no signal, slow server) counts as sent (booking-a-03)', async () => {
    const s = server({ 'v-1': 'queued', 'v-2': 'queued' });
    const r = await sendVisit(two(), { walkIn: false, choice: block, mayForce: true }, s.deps);
    expect(r.map((x) => x.status)).toEqual(['queued', 'queued']);
  });
  it('« Réserver quand même » is asked once for the visit (the same moment for every car)', async () => {
    const s = server({ 'v-1': 'full', 'v-2': 'full' }, { force: true });
    const r = await sendVisit(two(), { walkIn: false, choice: block, mayForce: true }, s.deps);
    expect(s.asked).toHaveLength(1);
    expect(r.map((x) => x.status === 'booked' && x.sentForced)).toEqual([true, true]);
  });
  it('« Choisir un autre bloc »: refused, declined; nobody may force but the owner and the office', async () => {
    const no = server({ 'v-1': 'full' });
    expect(await sendVisit(two(), { walkIn: false, choice: block, mayForce: true }, no.deps)).toEqual([{ key: 'v-1', status: 'refused', code: 'block_full', msg: 'block_full', declined: true }]);
    const mech = server({ 'v-1': 'full' }, { force: true });
    expect((await sendVisit(two(), { walkIn: false, choice: block, mayForce: false }, mech.deps))[0]).toMatchObject({ status: 'refused', declined: false });
    expect(mech.asked).toHaveLength(0);
  });
  it('a walk-in: no moment sent', async () => {
    const calls: unknown[] = [];
    const s = server({});
    s.deps.walkIn = async (job) => { calls.push(job); return { queued: false, id: (job as BookInput).id! }; };
    const r = await sendVisit(jobsOf([car('v-1', 'id-1', [line('Huile')])], null), { walkIn: true, choice: null, mayForce: true }, s.deps);
    expect(r[0]).toMatchObject({ status: 'booked', id: 'id-1' });
    expect(calls[0]).not.toHaveProperty('day');
  });
});

describe('what is said after « Réserver »', () => {
  const w = { t: (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`, bt: (k: string, v?: Record<string, string | number>) => `bt:${k}${v ? JSON.stringify(v) : ''}` };
  const o = (results: Parameters<typeof outcome>[0], total = results.length, walkIn = false) => outcome(results, { total, walkIn, day: '2026-11-18', when: 'Demain matin' }, w);
  const booked = (key: string, id = `id-${key}`, forced = false) => ({ key, status: 'booked' as const, id, forced, sentForced: forced });
  it('one car: « Réservé », the job opens, its text goes', () => {
    expect(o([booked('v-1')])).toMatchObject({ toasts: [{ text: 'booking.done{"when":"Demain matin"}', kind: 'ok' }], go: '/job/id-v-1', texts: ['id-v-1'] });
    expect(o([booked('v-1', 'id-1', true)]).toasts[0]).toMatchObject({ text: 'booking.force.done{"when":"Demain matin"}', kind: 'info', ms: 9000 });
  });
  it('several cars: one message, the agenda of the day, a text each', () => {
    expect(o([booked('v-1'), booked('v-2')])).toMatchObject({ toasts: [{ text: 'booking.cars.done{"n":2,"when":"Demain matin"}' }], go: '/agenda/2026-11-18', texts: ['id-v-1', 'id-v-2'] });
  });
  it('kept on the phone, one car or several: said, and the screen leaves; the answered ones get their text (booking-a-03, -04)', () => {
    const all = o([{ key: 'v-1', status: 'queued' }, { key: 'v-2', status: 'queued' }]);
    expect(all).toMatchObject({ toasts: [{ text: 'bt:queued', ms: 10000 }], go: '/agenda/2026-11-18', texts: [] });
    expect(o([booked('v-1'), { key: 'v-2', status: 'queued' }])).toMatchObject({ go: '/agenda/2026-11-18', texts: ['id-v-1'] });
    expect(o([{ key: 'v-1', status: 'queued' }], 1, true)).toMatchObject({ toasts: [{ text: 'booking.queuedWalkIn' }], go: '/' });
  });
  it('a refusal after some cars: they leave the screen for good, the rest is tried in another moment', () => {
    const r = o([booked('v-1'), { key: 'v-2', status: 'queued' }, { key: 'v-3', status: 'refused', code: 'block_full', msg: 'Ce bloc est plein.', declined: false }], 3);
    expect(r.go).toBeNull();
    expect(r.done).toEqual(['v-1', 'v-2']);
    expect(r.toasts.map((x) => x.text)).toEqual(['Ce bloc est plein.', 'bt:cars.partial{"n":2,"total":3}']);
    expect(r.banner).toBe('Ce bloc est plein. bt:refusedBlock');
  });
  it('a window that can no longer be kept: the picker asks again', () => {
    expect(o([{ key: 'v-1', status: 'refused', code: 'window_full', msg: 'x', declined: false }])).toMatchObject({ windowGone: true, banner: 'booking.win.full', go: null });
  });
  it('« Choisir un autre bloc » after « Ce bloc est plein »: no second message, the reason above the moments', () => {
    const r = o([{ key: 'v-1', status: 'refused', code: 'block_full', msg: 'Plein.', declined: true }]);
    expect(r.toasts).toEqual([]);
    expect(r.banner).toBe('Plein. bt:refusedBlock');
  });
  it('« Choisis un autre bloc. » is said once (booking-a-16)', () => {
    expect(withHint('Ce bloc est complet. Choisis un autre bloc.', 'Choisis un autre bloc.')).toBe('Ce bloc est complet. Choisis un autre bloc.');
    expect(withHint('Ce bloc est complet.', 'Choisis un autre bloc.')).toBe('Ce bloc est complet. Choisis un autre bloc.');
  });
});
