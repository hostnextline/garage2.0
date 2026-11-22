/* « Réserver à l'heure choisie » (Part 30, K1, K2, the lead's correction): the flow of « Réserver » for a time the server
   does not offer, taken anyway (« complet »), against a pretended server (book_preview / book_job with arrive_at): room at
   that minute → booked there without a question (someone pushed inside their window is not asked); no room → the warning (who, how late, the truck's end), « Réserver quand même à 14 h » for the owner, why not for a
   mechanic; the truck cannot be there → « Mettre à … »; no answer → said plainly; no signal or an older server → booked
   as before; the day changed since → asked again once; a lost answer is never « réessaie ». */
import { describe, it, expect, beforeEach } from 'vitest';
import { lang } from '../../lib/i18n';
import { bookAtTime, atQuestion, earlyQuestion, type AtTimeDeps, type AtTimeAsk, type Question } from './atTime';
import { bookAtAnswer, type BookAtAnswer } from '../../data/bookAt';
import type { BookInput } from '../../data/api';

const DAY = '2026-11-26';
const win = (m: number): [number, number] => [Math.floor(m / 60) * 60 - 60, Math.floor(m / 60) * 60 + 180];
const stop = (id: string, o: Partial<{ before: number; after: number; late: boolean; lateMin: number; ws: number; we: number; delay: number }> = {}) => ({
  id, day: DAY, truck_id: 'T1', order_before: 1, order_after: 2, eta_before: o.before ?? 600, eta_after: o.after ?? o.before ?? 600,
  win_start: o.ws ?? 540, win_end: o.we ?? 780, delay_min: o.delay ?? Math.max(0, (o.after ?? o.before ?? 600) - (o.before ?? 600)),
  late: !!o.late, late_min: o.lateMin ?? 0, measured: null
});
const answer = (stops: ReturnType<typeof stop>[], extra: Record<string, unknown> = {}): BookAtAnswer =>
  bookAtAnswer({ ok: true, preview: true, exact: true, at: 840, job_id: 'NEW', truck_id: 'T1', win_start: 780, win_end: 1020, forced: false, may_force: true,
    stops: [stop('NEW', { before: undefined, after: 840 }), ...stops], over_hours: 0, earliest: 840, earliest_keep: 900, ...extra })!;
const refusal = (hint: string, details: unknown = null, message = 'refusé') => Object.assign(new Error(message), { code: 'P0001', hint, message, details: details == null ? null : JSON.stringify(details) });
const offline = () => Object.assign(new Error('Failed to fetch'), { status: 0 });
const busy503 = () => Object.assign(new Error('Service Unavailable'), { status: 503 });

let asked: Question[] = [];
let answers: boolean[] = [];
let booked: BookInput[] = [];
function deps(o: Partial<AtTimeDeps> & { previews?: (BookAtAnswer | null | Error | 'hang')[]; books?: (Error | Record<string, unknown>)[] } = {}): AtTimeDeps {
  const previews = [...(o.previews ?? [])];
  const books = [...(o.books ?? [])];
  return {
    preview: o.preview ?? (async () => {
      const p = previews.length > 1 ? previews.shift()! : previews[0];
      if (p === 'hang') return new Promise(() => undefined);
      if (p instanceof Error) throw p;
      return p ?? null;
    }),
    book: o.book ?? (async (job) => {
      booked.push(job);
      const b = books.length > 1 ? books.shift()! : books[0];
      if (b instanceof Error) throw b;
      return { id: job.id!, data: b ?? { ok: true, exact: true, at: job.arrive_at, job_id: job.id, truck_id: job.truck_id, forced: false, stops: [], over_hours: 0 } };
    }),
    ask: o.ask ?? (async (q) => { asked.push(q); return answers.length ? answers.shift()! : true; }),
    online: o.online ?? (() => true),
    nameOf: (id) => ({ D: 'Denis', E: 'Emma', F: 'Félix' } as Record<string, string>)[id] ?? 'un client',
    windowOf: win,
    lateWindow: o.lateWindow
  };
}
const ask = (x: Partial<AtTimeAsk> = {}): AtTimeAsk => ({
  job: { id: 'NEW', customer_id: 'C1', day: DAY, block: 'day', duration_min: 60, win_start: 780, force: true } as BookInput,
  lines: [{ description: 'Diagnostic' }], at: 840, truck: null, name: 'Julie', mayForce: true, previewMs: 50, ...x
});

beforeEach(() => { asked = []; answers = []; booked = []; lang.value = 'fr'; });

describe('room at that minute', () => {
  it('nobody’s hour changes: booked AT 14 h on the vehicle the server chose, no question, never « force »', async () => {
    const r = await bookAtTime(ask(), deps({ previews: [answer([stop('D', { before: 600 })])] }));
    expect(asked).toEqual([]);
    expect(r.kind).toBe('booked');
    expect(booked).toHaveLength(1);
    expect(booked[0]).toMatchObject({ arrive_at: 840, truck_id: 'T1', late_ok: [], day: DAY, block: 'day' });
    expect(booked[0].force).toBeUndefined();
    if (r.kind === 'booked') { expect(r.at).toBe(840); expect(r.late).toEqual([]); expect(r.pushed).toEqual([]); expect(r.forced).toBe(false); }
  });
  it('someone pushed later inside their window: no question (as a booking with room never asked), booked at that minute; the answer says who moved', async () => {
    const pv = answer([stop('D', { before: 880, after: 910, ws: 840, we: 1080 })]);
    // the booking's own answer says who moved (the server's, not the preview's)
    const r = await bookAtTime(ask(), deps({ previews: [pv], books: [{ ok: true, exact: true, at: 840, job_id: 'NEW', truck_id: 'T1', forced: false,
      stops: [stop('D', { before: 880, after: 910, ws: 840, we: 1080 })], over_hours: 0 }] }));
    expect(asked).toEqual([]);
    expect(r.kind).toBe('booked');
    if (r.kind === 'booked') { expect(r.pushed).toEqual(['D']); expect(r.forced).toBe(false); }
    expect(booked[0]).toMatchObject({ arrive_at: 840, late_ok: [] });
  });
});

describe('no room: the warning first', () => {
  const late = () => answer([stop('D', { before: 700, after: 830, late: true, lateMin: 50, ws: 540, we: 780 }), stop('E', { before: 900, after: 960, ws: 840, we: 1080 })],
    { forced: true, over_hours: 25 });
  it('the owner: who would be late and by how much, the truck past its hours; « Réserver quand même à 14 h » books with them accepted (and its own id for the hours)', async () => {
    const r = await bookAtTime(ask(), deps({ previews: [late()], books: [{ ok: true, exact: true, at: 840, job_id: 'NEW', truck_id: 'T1', forced: true,
      stops: [stop('D', { before: 700, after: 830, late: true, lateMin: 50 })], over_hours: 25 }] }));
    expect(asked).toHaveLength(1);
    const q = asked[0];
    expect(q.title).toBe('Réserver Julie à 14 h met Denis en retard');
    expect(q.text).toContain('Denis : vers 13 h 50, 50 min après sa plage (9 h à 13 h).');
    expect(q.text).toContain('Le camion finirait sa journée 25 min après ses heures.');
    expect(q.text).toContain('Emma : vers 16 h au lieu de 15 h.');
    expect(q.ok).toBe('Réserver quand même à 14 h');
    expect(q.cancel).toBe('Choisir une autre heure');
    expect(q.danger).toBe(true);
    expect(booked[0].late_ok).toEqual(['D', 'NEW']);
    expect(r).toMatchObject({ kind: 'booked', forced: true, late: ['D'] });
  });
  it('the truck past its hours only: its own title', async () => {
    await bookAtTime(ask(), deps({ previews: [answer([], { forced: true, over_hours: 40 })] }));
    expect(asked[0].title).toBe('Réserver Julie à 14 h : le camion finit après ses heures');
    expect(booked[0].late_ok).toEqual(['NEW']);
  });
  it('« Choisir une autre heure »: nothing booked', async () => {
    answers = [false];
    expect(await bookAtTime(ask(), deps({ previews: [late()] }))).toEqual({ kind: 'stopped' });
    expect(booked).toEqual([]);
  });
  it('a mechanic (may_force false): the same warning says why not, its only way out is another time; nothing booked', async () => {
    const r = await bookAtTime(ask({ mayForce: false }), deps({ previews: [{ ...late(), mayForce: false }] }));
    expect(asked[0].text).toContain('Seuls le propriétaire et le bureau peuvent réserver quand même.');
    expect(asked[0].ok).toBe('Choisir une autre heure');
    expect(asked[0].danger).toBeFalsy();
    expect(r).toEqual({ kind: 'stopped', why: 'mechanic' });
    expect(booked).toEqual([]);
  });
  it('a late customer whose new window leaves with « Envoyer les heures aux clients »: said in the warning', async () => {
    await bookAtTime(ask(), deps({ previews: [late()], lateWindow: (s) => (s.id === 'D' ? [780, 1020] : null) }));
    expect(asked[0].text).toContain('Il aura 13 h à 17 h avec « Envoyer les heures aux clients ».');
  });
});

describe('the truck cannot be there, no answer, no signal, the day changed', () => {
  it('arrive_late with the earliest: « Mettre à 14 h 20 », then booked at that minute (no second question)', async () => {
    const at20 = answer([stop('D', { before: 600 })], { at: 860 });
    const r = await bookAtTime(ask(), deps({ previews: [refusal('arrive_late', { earliest: 860, earliest_keep: 900 }), at20] }));
    expect(asked).toHaveLength(1);
    expect(asked[0].title).toBe('Pas possible à 14 h');
    expect(asked[0].text).toContain('Le camion ne peut pas être chez Julie à 14 h : au plus tôt 14 h 20.');
    expect(asked[0].text).toContain('À 15 h, aucun autre arrêt ne change d’heure.');
    expect(asked[0].ok).toBe('Mettre à 14 h 20');
    expect(booked[0].arrive_at).toBe(860);
    expect(r).toMatchObject({ kind: 'booked', at: 860 });
  });
  it('the earliest in another window: its window said', () => {
    const q = earlyQuestion({ earliest: 905, keep: null }, { name: 'Julie', at: 840 }, { windowOf: win });
    expect(q?.text).toContain('À 15 h 05, sa plage devient : entre 14 h et 18 h.');
  });
  it('no answer in time: said plainly, « Réserver quand même » books (the server still refuses a lateness not accepted)', async () => {
    const r = await bookAtTime(ask(), deps({ previews: ['hang'] }));
    expect(asked[0].text).toContain('Je n’ai pas pu vérifier l’heure des autres clients.');
    expect(asked[0].ok).toBe('Réserver quand même');
    expect(r.kind).toBe('booked');
    expect(booked[0].late_ok).toEqual([]);
  });
  it('a server error on the preview: the same', async () => {
    await bookAtTime(ask(), deps({ previews: [busy503()] }));
    expect(asked[0].text).toContain('Je n’ai pas pu vérifier');
  });
  it('no signal, or a server without the preview: booked as before by the caller (fallback), nothing asked', async () => {
    expect(await bookAtTime(ask(), deps({ online: () => false }))).toEqual({ kind: 'fallback' });
    expect(await bookAtTime(ask(), deps({ previews: [offline()] }))).toEqual({ kind: 'fallback' });
    expect(await bookAtTime(ask(), deps({ previews: [null] }))).toEqual({ kind: 'fallback' });
    expect(asked).toEqual([]);
    expect(booked).toEqual([]);
  });
  it('the day changed since the preview (late_changed): the preview again, the new warning, then booked', async () => {
    const late = answer([stop('D', { before: 700, after: 830, late: true, lateMin: 50 })], { forced: true });
    const r = await bookAtTime(ask(), deps({ previews: [answer([]), late], books: [refusal('late_changed', { late: [{ id: 'D', late_min: 50 }] }), { ok: true, exact: true, at: 840, job_id: 'NEW', forced: true, stops: [], over_hours: 0 }] }));
    expect(booked).toHaveLength(2);
    expect(booked[1].late_ok).toEqual(['D']);
    expect(asked).toHaveLength(1);
    expect(asked[0].title).toContain('met Denis en retard');
    expect(r.kind).toBe('booked');
  });
  it('a lost answer: never « réessaie » (it may be booked); no signal at the booking: nothing kept', async () => {
    expect(await bookAtTime(ask(), deps({ previews: [answer([])], books: [busy503()] }))).toEqual({ kind: 'stopped', why: 'lost' });
    expect(await bookAtTime(ask(), deps({ previews: [answer([])], books: [offline()] }))).toEqual({ kind: 'stopped', why: 'offline' });
  });
  it('another refusal (the right, a day closed): given back with its words', async () => {
    const r = await bookAtTime(ask(), deps({ previews: [refusal('not_allowed', null, 'Tu ne peux pas prendre de rendez-vous.')] }));
    expect(r.kind).toBe('refused');
    expect(booked).toEqual([]);
  });
});

describe('the words in English', () => {
  it('the warning', () => {
    lang.value = 'en';
    const c = { kind: 'late' as const, late: [answer([stop('D', { after: 830, late: true, lateMin: 50 })]).stops[1]], pushed: [], overHours: 0 };
    const q = atQuestion(c, { name: 'Julie', day: DAY, at: 840, may: true }, { nameOf: () => 'Denis', windowOf: win });
    expect(q?.title).toBe('Booking Julie at 2 p.m. makes Denis late');
    expect(q?.ok).toBe('Book anyway at 2 p.m.');
    const m = atQuestion(c, { name: 'Julie', day: DAY, at: 840, may: false }, { nameOf: () => 'Denis', windowOf: win });
    expect(m?.text).toContain('Only the owner and the office can book anyway.');
  });
});
