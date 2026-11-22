/* DEV ONLY — « Envoyer les heures aux clients » (Part 28, REARRANGE.md §1.5, §1.6) in the demo, with the database's rules:
   - the demo's coming appointments whose confirmation went are « told » their hours (told_install, rule 1), the others
     stay never told (the first press's N);
   - tell_list(p_day) and tell_mark(p_marks) (owner / « Réserver »; « C'est envoyé » also by the mechanic who may act on
     the job, job_actor), answered from the twin of the server's rule (domain/jobs/told.ts);
   - the told writes (`toldDone`, the twin of tell_done) and the lease's « due? » (`tellDue`, tell_take's test) that the
     demo's ONE notify (demo-extra/jobs.ts) uses for action 'day' and the single booking / window / moved texts.
   Tested in src/dev/demo-tell.test.ts. */
import { registerRpc, put, find, table, rows, refuse, nowIso, type DemoRow } from '../fake-server';
import { can, demoUser, jobActor, jobVisible, need } from '../demo-rules';
import { tellCtxOf, tellNow, tellState, tellKind, tellRows, isDue, type TellCtx, type TellKind, type TellListJob } from '../../domain/jobs/told';
import { nowMinute, today } from '../../lib/dates';

const RIGHT = 'Seuls le propriétaire et le bureau envoient les heures aux clients.';
const booking = () => ((find('settings', '1')?.booking || {}) as Record<string, unknown>);
/** the rule's context from the demo's settings and clock (local_today, now_min) */
export const demoCtx = (): TellCtx => tellCtxOf(booking(), today(), nowMinute());
/** Réglages → Textos: that kind of text switched on (absent = on, as notify) */
export const kindOn = (k: string): boolean => ((find('settings', '1')?.messages as { on?: Record<string, boolean> } | undefined)?.on?.[k]) !== false;
const asJob = (j: DemoRow) => j as unknown as TellListJob;
/** booked, not deleted, today or later */
const coming = (j: DemoRow) => !j.deleted_at && j.status === 'booked' && String(j.day) >= today();

/** what the lease lets through (tell_take): due now ('new' / 'changed'), or « Renvoyer » of a « peut-être parti » still
    'ok', or the single path's resend (`force`); a 'drift' job never unless forced */
export function tellDue(j: DemoRow, o: { again?: boolean; force?: boolean } = {}): boolean {
  if (!coming(j)) return false;
  const s = tellState(asJob(j), demoCtx());
  return isDue(s) || (o.again === true && j.told_how === 'maybe' && s === 'ok') || o.force === true;
}
/** the hours a single text says (the job as it is: its window, its block's hours, or « dans la journée ») */
export function hoursSaid(j: DemoRow): { day: string; start: number | null; end: number | null } {
  if (j.block === 'day') return { day: String(j.day), start: j.win_start == null ? null : Number(j.win_start), end: j.win_end == null ? null : Number(j.win_end) };
  const b = demoCtx().blocks.find((x) => x.key === j.block);
  return { day: String(j.day), start: b ? b.start : null, end: b ? b.end : null };
}
/** tell_now's hours and kind of a job (what the day's button texts) */
export function nowOf(j: DemoRow): { day: string; start: number | null; end: number | null; rewin: boolean; kind: TellKind | null } {
  const ctx = demoCtx();
  const n = tellNow(asJob(j), ctx);
  return { day: n.day, start: n.start, end: n.end, rewin: n.rewin, kind: tellKind(asJob(j), ctx) };
}
/** tell_done: the customer was told these hours (how: sms / maybe / hand / call); the window written when `rewin` (the
    ONE place a window moves because of an arrival outside it); confirm_sent_at unless the kind is 'window' */
export function toldDone(j: DemoRow, h: { day: string; start: number | null; end: number | null; rewin?: boolean }, how: string, kind: string | null, by: string | null = demoUser()): DemoRow {
  return put('jobs', {
    id: j.id, told_day: h.day, told_start: h.start, told_end: h.end, told_at: nowIso(), told_how: how, told_by: by,
    ...(kind === 'window' ? {} : { confirm_sent_at: nowIso() }),
    ...(h.rewin && j.status === 'booked' && String(j.day) === h.day ? { win_start: h.start, win_end: h.end } : {})
  });
}

/** told_install, rule 1 (and 2 with no window message: « dans la journée »): a coming job whose confirmation went */
function install() {
  for (const j of table('jobs')) {
    if (!coming(j) || j.told_at || !j.confirm_sent_at) continue;
    const flexFixed = j.block === 'day' && j.win_flex === true && j.win_start != null;
    const h = flexFixed ? { day: String(j.day), start: null, end: null } : hoursSaid(j);
    put('jobs', { id: j.id, told_day: h.day, told_start: h.start, told_end: h.end, told_at: String(j.confirm_sent_at), told_how: 'install', told_by: null });
  }
}

function ops() {
  registerRpc('tell_list', (a) => {
    need(can('book'), RIGHT);
    const day = String(a.p_day || '');
    const jobs = table('jobs').filter((j) => !j.deleted_at && jobVisible(j)).map(asJob);
    return tellRows(day, jobs, demoCtx(), (cid) => { const c = find('customers', cid); return c ? { phone: (c.phone as string | null) ?? null, sms_ok: c.sms_ok as boolean | undefined } : null; }, kindOn);
  });
  registerRpc('tell_mark', (a) => {
    const marks = (Array.isArray(a.p_marks) ? a.p_marks : []) as { id?: string; how?: string; kind?: string | null; day?: string; start?: number | null; end?: number | null }[];
    // rights first, for every id: one refused = nothing written
    for (const m of marks) {
      const j = find('jobs', m.id);
      const ok = can('book') || (m.how === 'hand' && !!j && jobActor(j));
      need(ok && (!j || jobVisible(j)), RIGHT);
      if (m.how !== 'call' && m.how !== 'hand') refuse('bad_list', 'Liste incomplète.');
    }
    const marked: string[] = [], changed: string[] = [], out: DemoRow[] = [];
    for (const m of marks) {
      const j = find('jobs', m.id);
      if (!j || !coming(j)) { changed.push(String(m.id)); continue; }
      const n = nowOf(j);
      if (n.day !== m.day || n.start !== (m.start ?? null) || n.end !== (m.end ?? null)) { changed.push(j.id); continue; }
      out.push(toldDone(j, n, String(m.how), m.kind ?? n.kind));
      marked.push(j.id);
    }
    return { ok: true, marked, changed, busy: [], rows: rows({ jobs: out }) };
  });
}

export function load() {
  try { install(); } catch { /* the demo goes on: every customer never told */ }
  try { ops(); } catch { /* the core's pretend operations stay */ }
}
