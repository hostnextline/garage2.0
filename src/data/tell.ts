/* « Envoyer les heures aux clients » (Part 28, REARRANGE.md §1.5, §1.6-1, §3.3): what the app asks the server.
   - tellList(day): the day's send list as the server sees it (tell_list: owner / « Réserver »; a read, never kept).
   - sendDay(day, only, again): the day's button = notify { action: 'day' } with the ids the person saw; each call has its
     OWN op (a lost answer is never asked again with the same op: the told and the lease make a new call safe, code F23).
   - tellMark(marks): « Je l'ai averti » (called) and « C'est envoyé » (a text sent by hand) = tell_mark, written only when
     the hours are still the ones to tell (else `changed`). Needs the network (never kept on the phone).
   Every answer is read defensively: a field missing or of the wrong kind reads as empty. Tested in tell.test.ts. */
import { callRpc, uuid } from './sync';
import { callFn, preview } from './auth';
import type { Job } from './types';
import { appBase } from '../lib/config';
import { Refused } from '../lib/errors';
import { t } from '../lib/i18n';

export type TellKindName = 'booking' | 'window' | 'moved';
/** a day and hours (minutes of the day; null, null = « dans la journée ») */
export interface ToldHours { day: string; start: number | null; end: number | null }
/** a row of tell_list */
export interface TellRow {
  id: string; number: number; customer_id: string | null;
  state: 'new' | 'changed' | 'drift';
  /** the text he gets (null: a 'drift' row, never texted by the button) */
  kind: TellKindName | null;
  told: (ToldHours & { at: string; how: Job['told_how'] }) | null;
  now: ToldHours & { rewin: boolean };
  phone_ok: boolean; sms_ok: boolean; kind_on: boolean;
}
/** « Je l'ai averti » (call) / « C'est envoyé » (hand): the hours that person told him */
export interface TellMark extends ToldHours { id: string; how: 'call' | 'hand'; kind: TellKindName | null }
export interface MarkAnswer { ok: boolean; marked: string[]; changed: string[]; busy: string[] }
/** a text that could not go by itself: to send by hand (`by_hand`), or refused by the texting service (`failed`) */
export interface DayHand { id: string; phone: string | null; message: string; link: string | null; told: ToldHours | null; kind: TellKindName | null }
export interface DayFailed { id: string; error: string; phone: string | null; told: ToldHours | null; kind: TellKindName | null }
export interface DayQuiet { id: string; phone: string | null; why: 'sms_ok' | 'kind_off' | string }
/** notify { action: 'day' } (§1.6-1); `ok` false: refused (`code`, `error`: not_allowed, bad_list…) */
export interface DayAnswer {
  ok: boolean; code?: string; error?: string; status?: string;
  sent: string[]; maybe: string[]; already: string[]; busy: string[]; gone: string[];
  quiet: DayQuiet[]; no_phone: string[]; failed: DayFailed[]; by_hand: DayHand[]; left: string[];
}

function guard() { if (preview.value) throw new Refused('preview', t('errors.preview')); }

const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const strOrNull = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const minOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const objs = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : []);
const KINDS: readonly string[] = ['booking', 'window', 'moved'];
const kindOf = (x: unknown): TellKindName | null => (typeof x === 'string' && KINDS.includes(x) ? (x as TellKindName) : null);
const HOWS: readonly string[] = ['sms', 'maybe', 'hand', 'call', 'install'];
/** a day and hours from an answer (null: none, or no day) */
export function hoursOf(x: unknown): ToldHours | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const day = str(o.day);
  return day ? { day, start: minOrNull(o.start), end: minOrNull(o.end) } : null;
}

/** tell_list's rows, read defensively (a row without an id or a day is dropped) */
export function tellRowsOf(x: unknown): TellRow[] {
  const out: TellRow[] = [];
  for (const o of objs(x)) {
    const id = str(o.id), now = hoursOf(o.now);
    if (!id || !now) continue;
    const st = o.state === 'new' || o.state === 'changed' || o.state === 'drift' ? o.state : null;
    if (!st) continue;
    const told = hoursOf(o.told);
    const tr = (o.told && typeof o.told === 'object' ? o.told : {}) as Record<string, unknown>;
    out.push({
      id, number: typeof o.number === 'number' ? o.number : 0, customer_id: strOrNull(o.customer_id), state: st, kind: kindOf(o.kind),
      told: told ? { ...told, at: str(tr.at), how: (typeof tr.how === 'string' && HOWS.includes(tr.how) ? tr.how : null) as Job['told_how'] } : null,
      now: { ...now, rewin: (o.now as Record<string, unknown>).rewin === true },
      phone_ok: o.phone_ok === true, sms_ok: o.sms_ok !== false, kind_on: o.kind_on !== false
    });
  }
  return out;
}
/** the day's send list as the server sees it (never kept on the phone: a read) */
export async function tellList(day: string): Promise<TellRow[]> {
  const r = await callRpc<unknown>('tell_list', { p_day: day }, { noOp: true });
  return tellRowsOf(r.data);
}

/** notify's day answer, read defensively */
export function dayAnswerOf(x: unknown): DayAnswer {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const ok = o.ok !== false && (o.status === 'done' || o.status === undefined);
  return {
    ok, code: typeof o.code === 'string' ? o.code : undefined, error: typeof o.error === 'string' ? o.error : undefined, status: typeof o.status === 'string' ? o.status : undefined,
    sent: ids(o.sent), maybe: ids(o.maybe), already: ids(o.already), busy: ids(o.busy), gone: ids(o.gone), no_phone: ids(o.no_phone), left: ids(o.left),
    quiet: objs(o.quiet).filter((q) => str(q.id)).map((q) => ({ id: str(q.id), phone: strOrNull(q.phone), why: str(q.why) })),
    failed: objs(o.failed).filter((q) => str(q.id)).map((q) => ({ id: str(q.id), error: str(q.error), phone: strOrNull(q.phone), told: hoursOf(q.told), kind: kindOf(q.kind) })),
    by_hand: objs(o.by_hand).filter((q) => str(q.id)).map((q) => ({ id: str(q.id), phone: strOrNull(q.phone), message: str(q.message), link: strOrNull(q.link), told: hoursOf(q.told), kind: kindOf(q.kind) }))
  };
}
/** the day's button: texts the appointments `only` (the ones the person saw); `again`: the « Renvoyer » of a « peut-être
    parti ». A NEW op each call. Throws when the server cannot be reached (no network, no answer): the caller reads the
    list again, it never asks the same op twice. */
export async function sendDay(day: string, only: readonly string[], again: readonly string[] = []): Promise<DayAnswer> {
  guard();
  const r = await callFn<Record<string, unknown>>('notify', { action: 'day', day, base: appBase(), op: uuid(), only: [...only], ...(again.length ? { again: [...again] } : {}) });
  return dayAnswerOf(r);
}

/** « Je l'ai averti » / « C'est envoyé »: marked told when the hours are still the ones to tell. Needs the network. */
export async function tellMark(marks: readonly TellMark[]): Promise<MarkAnswer> {
  guard();
  const r = await callRpc<Record<string, unknown>>('tell_mark', { p_marks: marks.map((m) => ({ id: m.id, how: m.how, kind: m.kind, day: m.day, start: m.start, end: m.end })) }, { queue: false });
  const d = (r.data ?? {}) as Record<string, unknown>;
  return { ok: d.ok !== false, marked: ids(d.marked), changed: ids(d.changed), busy: ids(d.busy) };
}
