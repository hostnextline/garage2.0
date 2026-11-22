/* « Envoyer les heures aux clients » (Hassan, 2026-11-21: « dont send any text, put a button that will send for all
   clients, ill press it when day is filled and im done re organizing »; REARRANGE.md §3.3). The list of a day before
   sending, then what happened, in the same sheet:
   - Built at once from the phone's copy (told.ts tellRows: the due ones, and today's « en retard sur sa plage » apart);
     the server's list (tell_list) is asked behind it and, when it differs, the sheet follows the server's (« La liste
     vient d'être mise à jour. »). « Ils reçoivent un texto » = the rows a text can reach, grouped under the customer's
     name (two cars: two texts); « À avertir toi-même » = no cell, « ne veut pas de textos », or that kind switched off
     in Réglages (« Appeler », « Je l'ai averti »); today's 'drift' rows are never texted by the button.
   - NO per-row switch (« one button for all clients »): « Envoyer à N clients » = notify { action: 'day' } with the ids
     shown, called again with `left` and a NEW op until nothing is left (a lost answer is never asked again with the same
     op: the list is read again instead, « Encore à avertir : N »).
   - The result: sent, « peut-être parti » (« Renvoyer »), not sent (« Réessayer », « Je l'ai averti »), busy, already,
     to tell yourself, and, texts not connected, each message to send by hand (« Ouvrir dans Messages », « C'est
     envoyé », « Tout est envoyé »). Then every job is read again, so the day's lines drop.
   - The sheet coming back on screen (the phone locked during the send, an answer lost) reads the list again. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Phone, MessageSquareText, Send, CircleCheck, CircleHelp, CircleX } from 'lucide-preact';
import type { Job } from '../../data/types';
import { allJobs, customer as customerRow, customerName, settings, roadsOn, jobsOn, job as jobRow } from '../../data/select';
import { can } from '../../data/auth';
import { net, refetch, isNetworkError } from '../../data/sync';
import { tellList, sendDay, tellMark, type TellRow, type TellMark, type ToldHours, type TellKindName, type DayAnswer } from '../../data/tell';
import { warmRoads } from '../../data/roads';
import { errorMessage } from '../../data/api';
import { t, lang } from '../../lib/i18n';
import { addDays, clock, longDay, tinyDay, today } from '../../lib/dates';
import { e164, formatPhone, smsHref } from '../../lib/text';
import { tellCtx, tellRows, hoursWords, type TellKind } from '../../domain/jobs/told';
import { capFirst } from '../../domain/jobs/when';
import { Sheet, Button, Banner, Pill, Rows, RowItem, toast } from '../../ui';
import { jobFirstName } from './select';

/** what happened to one appointment (the last answer about it wins: « Réessayer » replaces « pas parti ») */
type What = 'sent' | 'maybe' | 'already' | 'busy' | 'gone' | 'quiet' | 'no_phone' | 'failed' | 'by_hand' | 'marked';
interface Outcome { id: string; what: What; phone?: string | null; error?: string; message?: string; link?: string | null; told?: ToldHours | null; kind?: TellKindName | null }

const kindOn = (k: TellKind) => settings.value.messages?.on?.[k] !== false;
const whoOf = (cid: string | null) => { const c = customerRow(cid); return c ? { phone: c.phone, sms_ok: c.sms_ok } : null; };
/** the rows a text can reach (never a 'drift' one) */
const reaches = (r: TellRow) => r.state !== 'drift' && r.phone_ok && r.sms_ok && r.kind_on;
/** the customer a row counts for (an appointment with no customer is one) */
const clientOf = (r: Pick<TellRow, 'id' | 'customer_id'>) => r.customer_id ?? `job:${r.id}`;
const customersOf = (rows: readonly TellRow[]) => new Set(rows.map(clientOf)).size;
/** the same list (who, why, what he gets): the server's replaces the phone's only when it differs */
const sig = (rows: readonly TellRow[]) => rows.map((r) => [r.id, r.state, r.kind, r.now.day, r.now.start, r.now.end, r.phone_ok, r.sms_ok, r.kind_on].join('|')).sort().join('\n');
/** what is not « still to tell » whatever a list read meanwhile says (a text just sent, maybe sent, being sent, marked) */
const DONE: ReadonlySet<What> = new Set<What>(['sent', 'maybe', 'already', 'busy', 'marked']);
/** the most rounds of one press (each round = one call with what is left) */
const MAX_ROUNDS = 25;
/** the most ids notify { action: 'day' } takes in one call (§1.6-1: more → bad_list) */
const DAY_MAX_IDS = 100;

/** the phone number of a row's customer */
const phoneOfRow = (r: TellRow) => customerRow(r.customer_id)?.phone ?? null;
/** the day's send list from the phone's own copy (the « Demain » panel reads it too) */
export function phoneTellRows(day: string): TellRow[] { return tellRows(day, allJobs.value, tellCtx(), whoOf, kindOn); }
/** why no text can reach him: « Pas de cellulaire », « Ne veut pas de textos », the kind off in Réglages; null: one can */
export function reasonOf(r: TellRow): string | null {
  if (reaches(r) || r.state === 'drift') return null;
  return t(!r.phone_ok ? 'tell.noPhone' : !r.sms_ok ? 'tell.noTexts' : 'tell.kindOff');
}
/** the customer's whole name, or the appointment's number */
export function nameOf(r: Pick<TellRow, 'customer_id' | 'number'>): string {
  return customerName(customerRow(r.customer_id)) || `#${r.number}`;
}
/** a first name for the result's lines (« Chloé, Omar ») */
function firstOf(id: string, rows: readonly TellRow[]): string {
  const j = jobRow(id);
  if (j) return jobFirstName(j);
  const r = rows.find((x) => x.id === id);
  return r ? nameOf(r) : '';
}
/** the hours he gets, with the day when it is not the list's day (moved from this day to another) */
export function nowWords(r: TellRow, day: string): string {
  const h = hoursWords(r.now.start, r.now.end);
  return r.now.day === day ? h : `${tinyDay(r.now.day, lang.value)}, ${h}`;
}
/** what he had (« avant : 9 h à 13 h », « avant : mar. 24 »), or what a never-told customer gets */
export function wasWords(r: TellRow): string {
  if (r.state === 'changed' && r.told) {
    return r.told.day !== r.now.day ? t('tell.otherDay', { day: tinyDay(r.told.day, lang.value) }) : t('tell.was', { when: hoursWords(r.told.start, r.told.end) });
  }
  return t(r.kind === 'window' ? 'tell.kindWindow' : r.kind === 'moved' ? 'tell.kindMoved' : 'tell.kindBooking');
}
const telOf = (phone: string | null | undefined) => (phone ? `tel:${e164(phone) || phone}` : null);
/** the stops of that day whose arrival is not measured yet (« Vraies routes » on): their hours may still change */
function unmeasuredOn(day: string): Job[] {
  return roadsOn.value ? jobsOn(day).filter((j) => j.status === 'booked' && j.eta_measured === false) : [];
}

export function TellSheet(p: { day: string; onClose: () => void }) {
  const l = lang.value;
  const mayTell = can('book');
  const phoneRows = phoneTellRows(p.day);
  const [server, setServer] = useState<TellRow[] | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [phase, setPhase] = useState<'list' | 'sending' | 'done'>('list');
  const [progress, setProgress] = useState({ done: 0, n: 0 });
  const [outcomes, setOutcomes] = useState<Map<string, Outcome>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [measuring, setMeasuring] = useState(false);
  /** after a send: the list was read again (what is left is known) */
  const [fresh, setFresh] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  /** the rows on screen when a send began: the hours a « Je l'ai averti » of its result marks (a list read since may
      no longer hold that row) */
  const shown = useRef<TellRow[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const all = (server ?? phoneRows).filter((r) => !marked.has(r.id));
  const reach = all.filter(reaches);
  const toCall = all.filter((r) => r.state !== 'drift' && !reaches(r));
  const drift = all.filter((r) => r.state === 'drift');
  const nReach = customersOf(reach);
  const unmeasured = unmeasuredOn(p.day);

  /** the server's list: it replaces the phone's when it differs (after a send: always, it is what is left) */
  const readList = async (after: boolean) => {
    try {
      const list = await tellList(p.day);
      if (!alive.current) return;
      const mine = tellRows(p.day, allJobs.peek(), tellCtx(), whoOf, kindOn);
      if (after || sig(list) !== sig(mine)) {
        setServer(list);
        if (!after && phaseRef.current === 'list') setRefreshed(true);
      } else setServer(null);
    } catch {
      // the phone's list stays (after a send: what the phone holds now says what is left)
      if (after && alive.current) setServer(null);
    } finally { if (after && alive.current) setFresh(true); }
  };
  useEffect(() => {
    alive.current = true;
    if (mayTell) void readList(false);
    // the sheet on screen again (the phone was locked, the app hidden during a send): what is left, read again
    const seen = () => { if (document.visibilityState === 'visible' && !busy.current && mayTell) void readList(phaseRef.current === 'done'); };
    document.addEventListener('visibilitychange', seen);
    return () => { alive.current = false; document.removeEventListener('visibilitychange', seen); };
  }, [p.day]);

  const send = async (only: readonly string[], again: readonly string[] = []) => {
    if (!only.length || busy.current) return;
    if (!net.peek().online) { toast(t('tell.offline'), { kind: 'bad' }); return; }
    busy.current = true;
    shown.current = [...(server ?? phoneRows), ...shown.current];
    setPhase('sending'); setFailure(null); setFresh(false); setProgress({ done: 0, n: only.length });
    const out = new Map(outcomes);
    let todo = [...only];
    try {
      for (let round = 0; todo.length && round < MAX_ROUNDS; round++) {
        // notify takes 100 ids at most a call (bad_list past it): a longer list goes in parts
        const part = todo.slice(0, DAY_MAX_IDS);
        const r = await sendDay(p.day, part, again.filter((id) => part.includes(id)));
        if (!r.ok) { setFailure(errorMessage(r)); break; }
        absorb(out, r);
        todo = [...r.left.filter((id) => part.includes(id)), ...todo.slice(DAY_MAX_IDS)];
        if (alive.current) { setProgress({ done: only.length - todo.length, n: only.length }); setOutcomes(new Map(out)); }
      }
    } catch (e) {
      // the answer was lost (no network, the phone locked): never the same op again; the list read again says what is left
      if (!isNetworkError(e)) setFailure(errorMessage(e));
    } finally {
      busy.current = false;
      for (const id of only) void refetch('jobs', id);
      if (alive.current) { setOutcomes(out); setPhase('done'); setRefreshed(false); void readList(true); }
    }
  };

  const mark = async (list: TellMark[]) => {
    if (!list.length) return;
    if (!net.peek().online) { toast(t('tell.offline'), { kind: 'bad' }); return; }
    try {
      const a = await tellMark(list);
      const rows = server ?? phoneRows;
      const names = (ids: string[]) => [...new Set(ids.map((id) => firstOf(id, rows)))].join(', ');
      if (a.marked.length) {
        toast(t('tell.marked', { n: a.marked.length, names: names(a.marked) }), { kind: 'ok' });
        if (alive.current) {
          setMarked((m) => new Set([...m, ...a.marked]));
          setOutcomes((o) => { const n = new Map(o); for (const id of a.marked) if (n.has(id)) n.set(id, { id, what: 'marked' }); return n; });
        }
      }
      if (a.changed.length) { toast(t('tell.markChanged', { names: names(a.changed) })); void readList(phaseRef.current === 'done'); }
      if (a.busy.length) toast(t('tell.busy', { names: names(a.busy) }));
      for (const m of list) void refetch('jobs', m.id);
    } catch (e) {
      toast(isNetworkError(e) ? t('tell.offline') : errorMessage(e), { kind: 'bad' });
    }
  };
  /** « Je l'ai averti » for a row of the list: the hours he must be told now */
  const callMark = (r: TellRow): TellMark => ({ id: r.id, how: 'call', kind: r.kind, day: r.now.day, start: r.now.start, end: r.now.end });
  /** the hours a message said (the answer's `told`), else what the list says he must be told */
  const rowFor = (id: string) => (server ?? phoneRows).find((x) => x.id === id) ?? shown.current.find((x) => x.id === id);
  const toldOfOutcome = (o: Outcome): ToldHours | null => {
    if (o.told) return o.told;
    const r = rowFor(o.id);
    return r ? { day: r.now.day, start: r.now.start, end: r.now.end } : null;
  };
  const markOutcome = (o: Outcome, how: 'call' | 'hand'): TellMark | null => {
    const h = toldOfOutcome(o);
    return h ? { id: o.id, how, kind: o.kind ?? rowFor(o.id)?.kind ?? null, ...h } : null;
  };

  const measure = async () => {
    if (measuring) return;
    setMeasuring(true);
    try {
      // each stop not measured: its own trips of that day (an address is what « drive » measures)
      const points = unmeasured.map((j) => (j.lat != null && j.lng != null ? { lat: j.lat, lng: j.lng } : (() => { const c = customerRow(j.customer_id); return c?.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null; })()))
        .filter((x): x is { lat: number; lng: number } => !!x);
      await Promise.all(points.map((pt) => warmRoads(pt, p.day, 1)));
      await readList(false);
    } finally { if (alive.current) setMeasuring(false); }
  };

  const day = capFirst(longDay(p.day, l));
  const sending = phase === 'sending';
  if (!mayTell) {
    return (
      <Sheet open onClose={p.onClose} title={t('tell.title')} sub={day} data-testid="tell-sheet" footer={<Button onClick={p.onClose}>{t('tell.close')}</Button>}>
        <p class="muted" style={{ margin: 0 }} data-testid="tell-right">{t('tell.right')}</p>
      </Sheet>
    );
  }
  const onlyIds = reach.map((r) => r.id);
  const footer = phase === 'done'
    ? <Button variant="primary" onClick={p.onClose} data-testid="tell-close">{t('tell.close')}</Button>
    : <>
        <Button onClick={p.onClose} disabled={sending} data-testid="tell-cancel">{t('tell.cancel')}</Button>
        <Button variant="primary" icon={<Send />} disabled={!nReach || sending} busy={sending} onClick={() => send(onlyIds)} data-testid="tell-go">
          {nReach ? t('tell.go', { n: nReach }) : t('tell.nobody')}
        </Button>
      </>;
  return (
    <Sheet open onClose={p.onClose} title={t('tell.title')} sub={day} data-testid="tell-sheet" footer={footer}>
      <div class="stack">
        {refreshed && <p class="small muted" style={{ margin: 0 }} role="status" data-testid="tell-refreshed">{t('tell.refreshed')}</p>}
        {sending && <p class="muted" style={{ margin: 0 }} role="status" aria-live="polite" data-testid="tell-progress">{t('tell.sending', { done: progress.done, n: progress.n })}</p>}
        {failure && <Banner kind="bad" data-testid="tell-failure">{failure}</Banner>}
        {phase === 'done'
          ? <>
              <Result day={p.day} outcomes={outcomes} rows={server ?? phoneRows} left={fresh ? reach.filter((r) => !DONE.has(outcomes.get(r.id)?.what as What)) : []}
                send={send} mark={mark} markOutcome={markOutcome} />
              {/* the ones to tell himself are still there once the texts went: the moment he closes the sheet (review F4) */}
              <ToCall day={p.day} rows={toCall.filter((r) => !outcomes.has(r.id))} sending={sending} mark={mark} callMark={callMark} />
            </>
          : <>
              {unmeasured.length > 0 && (
                <Banner kind="info" data-testid="tell-unmeasured"
                  action={<Button size="sm" busy={measuring} onClick={measure} data-testid="tell-measure">{t('tell.measureFirst')}</Button>}>
                  {t('tell.unmeasured', { n: unmeasured.length })}
                </Banner>
              )}
              {!all.length && <p class="muted" style={{ margin: 0 }} data-testid="tell-all">{t(p.day === addDays(today(), 1) ? 'tell.allTomorrow' : 'tell.all')}</p>}
              {reach.length > 0 && <ReachList day={p.day} rows={reach} n={nReach} />}
              <ToCall day={p.day} rows={toCall} sending={sending} mark={mark} callMark={callMark} />
              {drift.length > 0 && (
                <section class="stack" data-testid="tell-drift">
                  <h3 class="field-label" style={{ margin: 0 }}>{t('tell.drift', { n: drift.length })}</h3>
                  <Rows>
                    {drift.map((r) => {
                      const tel = telOf(phoneOfRow(r));
                      const eta = jobRow(r.id)?.eta_min;
                      const win = r.told ? hoursWords(r.told.start, r.told.end) : hoursWords(r.now.start, r.now.end);
                      return (
                        <RowItem key={r.id} data-testid="tell-drift-row" title={nameOf(r)}
                          sub={eta != null ? t('tell.driftAt', { time: clock(eta, l), window: win }) : win}
                          end={tel ? <Button size="sm" icon={<Phone size={16} />} href={tel}>{t('tell.call')}</Button> : undefined} />
                      );
                    })}
                  </Rows>
                </section>
              )}
            </>}
      </div>
    </Sheet>
  );
}

/** « À avertir toi-même »: no cell, refuses texts, that text switched off — « Appeler », « Je l'ai averti ». The buttons go
    under the words, so a long name is never cut by them on a 390 px phone (review F10) */
function ToCall(p: { day: string; rows: TellRow[]; sending: boolean; mark: (m: TellMark[]) => void; callMark: (r: TellRow) => TellMark }) {
  if (!p.rows.length) return null;
  return (
    <section class="stack" data-testid="tell-tocall">
      <h3 class="field-label" style={{ margin: 0 }}>{t('tell.toCall', { n: customersOf(p.rows) })}</h3>
      <Rows>
        {p.rows.map((r) => {
          const tel = telOf(phoneOfRow(r));
          return (
            <RowItem key={r.id} data-testid="tell-tocall-row" title={nameOf(r)}
              sub={<span style={{ display: 'block', whiteSpace: 'normal' }}>{nowWords(r, p.day)}<br /><span class="muted">{reasonOf(r)}</span>
                <span class="row-wrap" style={{ marginTop: 'var(--sp-2)' }}>
                  {tel && <Button size="sm" icon={<Phone size={16} />} href={tel}>{t('tell.call')}</Button>}
                  <Button size="sm" disabled={p.sending} onClick={() => p.mark([p.callMark(r)])} data-testid={`tell-mark-${r.id}`}>{t('tell.told')}</Button>
                </span></span>} />
          );
        })}
      </Rows>
    </section>
  );
}

/** « Ils reçoivent un texto »: each customer once, his appointments under his name */
function ReachList(p: { day: string; rows: TellRow[]; n: number }) {
  const groups = new Map<string, TellRow[]>();
  for (const r of p.rows) { const k = clientOf(r); const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }
  return (
    <section class="stack" data-testid="tell-reach">
      <h3 class="field-label" style={{ margin: 0 }}>{t('tell.getText', { n: p.n })}</h3>
      <Rows>
        {[...groups.values()].map((g) => (
          <RowItem key={g[0].id} data-testid="tell-row"
            title={<b>{nameOf(g[0])}{g.length > 1 ? ` (${t('tell.cars', { n: g.length })})` : ''}</b>}
            sub={<>{g.map((r) => (
              <span key={r.id} style={{ display: 'block', whiteSpace: 'normal' }} data-testid="tell-row-line">
                <b>{nowWords(r, p.day)}</b> <span class="muted">{wasWords(r)}</span>
              </span>
            ))}</>}
            end={g.every((r) => r.state === 'new') ? <Pill tone="booked">{t('tell.new')}</Pill> : undefined} />
        ))}
      </Rows>
    </section>
  );
}

/** puts one answer of notify's day into what happened, by appointment */
function absorb(out: Map<string, Outcome>, r: DayAnswer) {
  for (const id of r.sent) out.set(id, { id, what: 'sent' });
  for (const id of r.maybe) out.set(id, { id, what: 'maybe' });
  for (const id of r.already) out.set(id, { id, what: 'already' });
  for (const id of r.busy) out.set(id, { id, what: 'busy' });
  for (const id of r.gone) out.set(id, { id, what: 'gone' });
  for (const id of r.no_phone) out.set(id, { id, what: 'no_phone' });
  for (const q of r.quiet) out.set(q.id, { id: q.id, what: 'quiet', phone: q.phone });
  for (const f of r.failed) out.set(f.id, { id: f.id, what: 'failed', error: f.error, phone: f.phone, told: f.told, kind: f.kind });
  for (const h of r.by_hand) out.set(h.id, { id: h.id, what: 'by_hand', phone: h.phone, message: h.message, link: h.link, told: h.told, kind: h.kind });
}

/** what happened, then what is still to tell (« Encore à avertir : N ») with the button */
function Result(p: {
  day: string; outcomes: Map<string, Outcome>; rows: TellRow[]; left: TellRow[];
  send: (only: readonly string[], again?: readonly string[]) => void; mark: (m: TellMark[]) => void;
  markOutcome: (o: Outcome, how: 'call' | 'hand') => TellMark | null;
}) {
  const list = [...p.outcomes.values()];
  const of = (w: What) => list.filter((o) => o.what === w);
  // each customer named once (two cars: two texts, one name)
  const names = (os: Outcome[]) => [...new Set(os.map((o) => firstOf(o.id, p.rows)))].join(', ');
  const sent = of('sent'), maybe = of('maybe'), failed = of('failed'), busy = of('busy'), already = of('already');
  const self = [...of('quiet'), ...of('no_phone')];
  const hand = of('by_hand');
  const marks = (os: Outcome[], how: 'call' | 'hand') => os.map((o) => p.markOutcome(o, how)).filter((m): m is TellMark => !!m);
  const nLeft = customersOf(p.left);
  return (
    <div class="stack" data-testid="tell-result">
      {sent.length > 0 && <p class="row-wrap" style={{ margin: 0 }} data-testid="tell-sent"><CircleCheck size={18} aria-hidden="true" />{t('tell.sent', { n: sent.length, names: names(sent) })}</p>}
      {maybe.length > 0 && (
        <div class="row-wrap" data-testid="tell-maybe">
          <CircleHelp size={18} aria-hidden="true" /><span class="grow">{t('tell.maybe', { names: names(maybe) })}</span>
          <Button size="sm" onClick={() => p.send(maybe.map((o) => o.id), maybe.map((o) => o.id))} data-testid="tell-resend">{t('tell.resend')}</Button>
        </div>
      )}
      {failed.map((o) => {
        const m = p.markOutcome(o, 'call');
        return (
          <div key={o.id} class="row-wrap" data-testid="tell-failed">
            <CircleX size={18} aria-hidden="true" /><span class="grow">{t('tell.failed', { name: firstOf(o.id, p.rows), why: o.error || t('jobs.text.error') })}</span>
            <Button size="sm" onClick={() => p.send([o.id])} data-testid={`tell-retry-${o.id}`}>{t('tell.retry')}</Button>
            {m && <Button size="sm" onClick={() => p.mark([m])} data-testid={`tell-mark-${o.id}`}>{t('tell.told')}</Button>}
          </div>
        );
      })}
      {busy.length > 0 && <p class="small muted" style={{ margin: 0 }} data-testid="tell-busy">{t('tell.busy', { names: names(busy) })}</p>}
      {already.length > 0 && <p class="small muted" style={{ margin: 0 }} data-testid="tell-already">{t('tell.already', { names: names(already) })}</p>}
      {self.length > 0 && (
        <section class="stack" data-testid="tell-self">
          <h3 class="field-label" style={{ margin: 0 }}>{t('tell.toCall', { n: self.length })}</h3>
          {self.map((o) => {
            const tel = telOf(o.phone ?? customerRow(jobRow(o.id)?.customer_id)?.phone);
            const m = p.markOutcome(o, 'call');
            return (
              <div key={o.id} class="row-wrap" data-testid="tell-self-row">
                <span class="grow">{firstOf(o.id, p.rows)}{o.phone ? ` ${formatPhone(o.phone)}` : ''}</span>
                {tel && <Button size="sm" icon={<Phone size={16} />} href={tel}>{t('tell.call')}</Button>}
                {m && <Button size="sm" onClick={() => p.mark([m])} data-testid={`tell-mark-${o.id}`}>{t('tell.told')}</Button>}
              </div>
            );
          })}
        </section>
      )}
      {hand.length > 0 && (
        <section class="stack" data-testid="tell-byhand">
          <Banner kind="warn">{t('tell.byHand')}</Banner>
          {hand.map((o) => {
            const body = o.link && !(o.message || '').includes(o.link) ? `${o.message || ''}\n${o.link}`.trim() : (o.message || o.link || '');
            const m = p.markOutcome(o, 'hand');
            return (
              <div key={o.id} class="stack" data-testid="tell-byhand-row">
                <b>{firstOf(o.id, p.rows)}</b>
                <p class="jobs-msgbox" style={{ margin: 0 }}>{body}</p>
                <div class="row-wrap">
                  <Button size="sm" icon={<MessageSquareText size={16} />} href={smsHref(o.phone, body)} data-testid={`tell-open-${o.id}`}>{t('tell.open')}</Button>
                  {m && <Button size="sm" variant="primary" onClick={() => p.mark([m])} data-testid={`tell-handed-${o.id}`}>{t('tell.sentByHand')}</Button>}
                </div>
              </div>
            );
          })}
          {hand.length > 1 && <Button onClick={() => p.mark(marks(hand, 'hand'))} data-testid="tell-all-sent">{t('tell.allSent')}</Button>}
        </section>
      )}
      {nLeft > 0 && (
        <div class="row-wrap" data-testid="tell-left">
          <span class="grow">{t('tell.left', { n: nLeft })}</span>
          <Button size="sm" variant="primary" icon={<Send size={16} />} onClick={() => p.send(p.left.map((r) => r.id))} data-testid="tell-go-left">{t('tell.go', { n: nLeft })}</Button>
        </div>
      )}
      {!list.length && !nLeft && <p class="muted" style={{ margin: 0 }}>{t(p.day === addDays(today(), 1) ? 'tell.allTomorrow' : 'tell.all')}</p>}
    </div>
  );
}
