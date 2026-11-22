/* « Vraies routes » (Part 27, CONTRACT §1 §3), built like « Plages d'arrivée » (WindowsPanel.tsx): what it is in plain
   words, where the measures stand (the server has TomTom's key or not, the trips still to measure, this month's spend
   against the ceiling), « Mesurer maintenant » (the function « drive », sweep, asked again while it says `more`, with its
   progress), and the owner's switch behind a question:
   - ON: the usual-hours trips of the coming days are measured first (the server refuses ON while one is missing:
     roads_cold), then roads_switch; refused roads_cold anyway (an address was added meanwhile): measured once more and
     asked once more. Then what happened: blocks planned again, blocks kept as they were, the appointments now later than
     the moment told (« à rappeler », with their names), and the settings and the appointments pulled.
   - OFF: roads_switch straight away (nothing to measure), the same report.
   Every failure in plain words (roadsModel.ts). The small settings beside it are part of the section's draft (saved
   with « Enregistrer »): the rush hours on / off, the month's ceiling, « proche » in minutes (only while on).
   A measure stops when the person leaves the screen (the round under way ends, no new one starts: the background sweep
   measures the rest later) — the switch ON is then not flipped, and the message says why. A roads_switch already sent
   ends as usual, and « Arrêter » is no longer offered once it is sent (review R5). What a run said (the message) and the
   lists (the blocks kept, the customers to call) are kept for the visit per account (no storage key), like WindowsPanel's
   list of customers to call; a new run never wipes a list, it adds its own (only the list's « Fermer » does: review R1).
   A roads_switch whose answer never came (no signal, the server unwell): the device pulls the settings and says what the
   server now has (review R6); the next try of that switch (at once when the server has it, else the person's next tap)
   sends the SAME operation, so the server gives its first answer again, with the list of customers to call (R6, second
   half: roads_switch keeps each operation's answer). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { MessageSquare, Phone, Route, Square } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { clock } from '../../../lib/dates';
import { e164 } from '../../../lib/text';
import { roadsOn, settings, job as jobOf, customer, customerName } from '../../../data/select';
import { measureRoads, roadsStatus, roadsSwitch, roadsSweeping, type RoadsStatus, type RoadsSwitchAnswer, type DriveRefused } from '../../../data/roads';
import { errorMessage } from '../../../data/api';
import { isNetworkError } from '../../../lib/errors';
import { pull, uuid } from '../../../data/sync';
import { access, isOwner, hasRole } from '../../../data/auth';
import { Panel, Field, Button, Banner, Switch, Kv, ask, toast } from '../../../ui';
import { Meter } from '../../../shared/charts/charts';
import { smsHref } from '../../../shared/invoices/share';
import { NumInput } from '../fields';
import { ROAD_NUMS } from './model';
import { unitOf } from './PlanNumbers';
import { keptWords } from './backToBlocks';
import { measureLoop, refusalOf, failWords, serviceNote, loopWords, lateRows, lateText, switchOutcome, rushBlockedNow,
  type LoopProgress, type LoopResult, type MeasureGoal, type RoadsOutcome } from './roadsModel';
import type { PartProps } from './BookingSection';

/* ---------- what goes on while the person may leave the screen (per account, for the visit) ---------- */
/** phase 'switch': roads_switch is sent (it cannot be stopped any more: no « Arrêter ») */
interface Run { who: string; kind: 'measure' | 'on' | 'off'; goal: MeasureGoal; progress: LoopProgress | null; top: number; phase?: 'measure' | 'switch' }
/** a measure or a switch under way on this device */
export const roadsRun = signal<Run | null>(null);
interface Note { kind: 'ok' | 'warn' | 'bad'; title?: string; text: string }
/** what the last run said, and what the switch did (blocks kept, customers to call), until « Fermer » */
export const lastRoads = signal<{ who: string; note: Note | null; out: RoadsOutcome | null } | null>(null);
/** « Arrêter » was touched during this run (cleared only when a run starts: a roads_cold retry never erases it, R5) */
let stopAsked = false;
/** a roads_switch whose answer never came, per account and direction, with its operation, until an answer comes: the
    next try of the same switch sends that op again (review R6) */
let lost: { who: string; on: boolean; op: string } | null = null;
/** the status was asked again after a run: every panel on screen reloads it */
const statusTick = signal(0);
/** the « Vraies routes » panels on screen, per account: none left = the person left the screen, the measure stops */
const onScreen = new Map<string, number>();
const watching = (who: string) => (onScreen.get(who) ?? 0) > 0;
function useOnScreen(who: string) {
  useEffect(() => {
    onScreen.set(who, (onScreen.get(who) ?? 0) + 1);
    return () => { const n = (onScreen.get(who) ?? 1) - 1; if (n > 0) onScreen.set(who, n); else onScreen.delete(who); };
  }, [who]);
}

const hasLists = (o: RoadsOutcome | null): o is RoadsOutcome => !!o && (o.kept.length > 0 || o.late.length > 0);
/** what the screen keeps, as given (« Fermer » of the message or of a list) */
const keep = (who: string, note: Note | null, out: RoadsOutcome | null) => {
  lastRoads.value = note || hasLists(out) ? { who, note, out: hasLists(out) ? out : null } : null;
};
/** a run's message, and what it adds to the lists: the blocks kept and the customers to call already listed stay until
    their « Fermer » (review R1: a new run, a failure, never wipe them); each one is listed once; the words of the kept blocks
    follow the switch as it is now */
const say = (who: string, note: Note | null, add: RoadsOutcome | null = null) => {
  const before = lastRoads.value && lastRoads.value.who === who ? lastRoads.value.out : null;
  let out: RoadsOutcome | null = before;
  if (hasLists(add)) {
    out = before
      ? { on: add.on, planned: add.planned,
          kept: [...before.kept, ...add.kept.filter((k) => !before.kept.some((x) => x.day === k.day && x.block === k.block))],
          late: [...before.late, ...add.late.filter((id) => !before.late.includes(id))] }
      : add;
  }
  keep(who, note, out);
};
const isCold = (e: unknown) => (e as { hint?: string; code?: string } | null)?.hint === 'roads_cold' || (e as { code?: string } | null)?.code === 'roads_cold';
const other = (r: DriveRefused) => errorMessage(r);
/** a run's progress, as the server counts it (the most left seen is the start of the meter) */
function onRound(who: string) {
  return (p: LoopProgress) => {
    const cur = roadsRun.value;
    if (!cur || cur.who !== who) return;
    roadsRun.value = { ...cur, progress: p, top: Math.max(cur.top, p.todo + (cur.progress ? 0 : p.stored)) };
  };
}
function measureWith(who: string, goal: MeasureGoal, top: number): Promise<LoopResult> {
  const cur = roadsRun.value;
  roadsRun.value = { who, kind: cur?.kind ?? 'measure', goal, progress: null, top, phase: 'measure' };
  return measureLoop(measureRoads, { goal, onRound: onRound(who), stopped: () => stopAsked, away: () => !watching(who) });
}
/** the words of a loop that did not reach what was wanted, for the switch ON */
function notReady(r: LoopResult): Note {
  const title = t('settings.booking.roads.notOn');
  if (r.end === 'failed' && r.failure) return { kind: 'bad', title, text: failWords(r.failure, other) };
  if (r.end === 'away') return { kind: 'warn', title, text: t('settings.booking.roads.awayOn') };
  const why = [loopWords(r), r.last ? serviceNote(r.last.tomtom, r.last.osrm, undefined, r.last.spent?.cap) : null].filter(Boolean).join(' ');
  return { kind: 'warn', title, text: why || t('settings.booking.roads.stuck', { n: r.last?.left0 ?? 0 }) };
}

/** « Mesurer maintenant »: everything missing over the coming days */
export async function measureNow(who: string, top = 0): Promise<LoopResult | null> {
  if (roadsRun.value) return null;
  roadsRun.value = { who, kind: 'measure', goal: 'all', progress: null, top };
  stopAsked = false;
  say(who, null);
  try {
    const r = await measureWith(who, 'all', top);
    const out: RoadsOutcome | null = r.kept.length || r.late.length ? { on: roadsOn.peek(), planned: r.planned, kept: r.kept, late: r.late } : null;
    if (r.end === 'failed' && r.failure) say(who, { kind: 'bad', title: t('settings.booking.roads.measureFailed'), text: failWords(r.failure, other) }, out);
    else {
      const note = r.last ? serviceNote(r.last.tomtom, r.last.osrm, undefined, r.last.spent?.cap) : null;
      const text = [loopWords(r), note].filter(Boolean).join(' ');
      say(who, { kind: r.end === 'done' && !note ? 'ok' : 'warn', text }, out);
    }
    if (r.late.length || r.planned > 0) await pull('jobs').catch(() => undefined);
    return r;
  } finally { roadsRun.value = null; statusTick.value++; }
}

/** the owner's switch, after the question: ON measures first; roads_cold once = measure again, ask again */
export async function turnRoads(who: string, on: boolean, top = 0): Promise<RoadsSwitchAnswer | null> {
  if (roadsRun.value) return null;
  roadsRun.value = { who, kind: on ? 'on' : 'off', goal: 'usual', progress: null, top };
  stopAsked = false;
  say(who, null);
  /** « Arrêter » touched while it measured (even in the last round): the switch is not sent */
  const stoppedNow = (r: LoopResult): boolean => {
    if (!stopAsked) return false;
    say(who, notReady(r.end === 'done' ? { ...r, end: 'stopped' } : r));
    return true;
  };
  /** the operation last sent: the one whose answer was lost for this account and direction, else a new one */
  let sentOp: string | null = null;
  /** roads_switch is sent: no « Arrêter » from here on */
  const send = () => {
    const cur = roadsRun.value;
    if (cur && cur.who === who) roadsRun.value = { ...cur, phase: 'switch', progress: null };
    sentOp = lost && lost.who === who && lost.on === on ? lost.op : uuid();
    return roadsSwitch(on, sentOp);
  };
  /** what it did stays on screen (also for someone who left Réglages meanwhile), and a toast says it at once */
  const present = async (a: RoadsSwitchAnswer): Promise<RoadsSwitchAnswer> => {
    // the answer has no rows: the device brings the setting and the appointments planned again
    await Promise.all([pull('settings'), pull('jobs')]).catch(() => undefined);
    // an earlier try of this switch got lost after the server did it, and this one (another op) finds it done, without
    // the list (R6)
    const wasLost = a.unchanged && lost != null && lost.who === who && lost.on === on;
    lost = null;
    const words = wasLost ? t(on ? 'settings.booking.roads.lostOn' : 'settings.booking.roads.lostOff')
      : a.unchanged ? t(on ? 'settings.booking.roads.alreadyOn' : 'settings.booking.roads.alreadyOff')
      : t(on ? 'settings.booking.roads.onDone' : 'settings.booking.roads.offDone', { n: a.planned });
    say(who, { kind: wasLost ? 'warn' : 'ok', text: words }, switchOutcome(a));
    toast(words, { kind: wasLost ? 'info' : 'ok' });
    return a;
  };
  try {
    if (on) {
      const r = await measureWith(who, 'usual', top);
      if (r.end !== 'done') { say(who, notReady(r)); return null; }
      if (stoppedNow(r)) return null;
    }
    let a: RoadsSwitchAnswer;
    try { a = await send(); }
    catch (e) {
      // a refusal: the operation never landed (a lost one included), the next try is a new one
      if (!isNetworkError(e) && lost && lost.who === who && lost.on === on) lost = null;
      if (!on || !isCold(e)) throw e;
      // an address was added while it measured: its trips first, then once more (a stop asked before is kept)
      const r = await measureWith(who, 'usual', 0);
      if (r.end !== 'done') { say(who, notReady(r)); return null; }
      if (stoppedNow(r)) return null;
      try { a = await send(); }
      catch (e2) { if (isCold(e2)) { say(who, { kind: 'warn', title: t('settings.booking.roads.notOn'), text: t('settings.booking.roads.fail.cold') }); return null; } throw e2; }
    }
    return await present(a);
  } catch (e) {
    if (isNetworkError(e) && sentOp) {
      // the answer never came: the server may have done it. Ask it what it has now (review R6)
      const op = sentOp;
      lost = { who, on, op };
      await Promise.all([pull('settings'), pull('jobs')]).catch(() => undefined);
      if (roadsOn.peek() === on) {
        // it did: the SAME operation asked again brings its first answer, with the customers to call (R6, second half)
        try { return await present(await roadsSwitch(on, op)); } catch { /* still no answer: said below */ }
        lost = null;
        const words = t(on ? 'settings.booking.roads.lostOn' : 'settings.booking.roads.lostOff');
        say(who, { kind: 'warn', text: words });
        toast(words, { kind: 'info' });
        return null;
      }
    }
    say(who, { kind: 'bad', title: t(on ? 'settings.booking.roads.notOn' : 'settings.booking.roads.notOff'), text: errorMessage(e) });
    return null;
  } finally { roadsRun.value = null; statusTick.value++; }
}

/* ---------- the panel ---------- */
export function RoadsPanel({ d, set, err, clear }: PartProps) {
  const on = roadsOn.value;
  const owner = isOwner();
  const mayMeasure = owner || hasRole('office');
  const who = access.value?.id || '';
  const run = roadsRun.value && roadsRun.value.who === who ? roadsRun.value : null;
  const busy = !!roadsRun.value;
  const last = lastRoads.value && lastRoads.value.who === who ? lastRoads.value : null;
  // the background sweep of this device (services) is measuring: « Mesurer maintenant » waits for it
  const behind = !run && roadsSweeping.value > 0;
  const tick = statusTick.value;
  useOnScreen(who);
  const [status, setStatus] = useState<RoadsStatus | null>(null);
  const asked = useRef(0);
  useEffect(() => () => { asked.current = -1; }, []);
  const load = async () => {
    const n = ++asked.current;
    let s: RoadsStatus;
    try { s = await roadsStatus(); } catch (e) { s = refusalOf(e); }
    if (n === asked.current) setStatus(s);
  };
  useEffect(() => { void load(); }, [tick, on]);
  const rushOn = settings.value.booking.roads_rush !== false;
  // what « Mesurer maintenant » can measure: without TomTom the rush hours never come (review R3)
  const top = status?.ok ? (rushOn && rushBlockedNow(status) ? status.left0 : status.left) : 0;
  const top0 = status?.ok ? status.left0 : 0;

  const turn = async (want: boolean) => {
    if (busy) return;
    const yes = await ask({ title: t(want ? 'settings.booking.roads.askOn' : 'settings.booking.roads.askOff'), text: t(want ? 'settings.booking.roads.askOnText' : 'settings.booking.roads.askOffText'),
      ok: t(want ? 'settings.booking.roads.askOnOk' : 'settings.booking.roads.askOffOk') });
    if (!yes) return;
    await turnRoads(who, want, top0);
  };

  const ROADS = ROAD_NUMS.filter((n) => n.k !== 'near_min' || on);
  return (
    <Panel title={t('settings.booking.roads.title')} help={t('settings.booking.roads.help')} data-testid="booking-roads">
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('settings.booking.roads.lead')}</p>
        <Switch checked={on} disabled={!owner || busy} onChange={(v) => void turn(v)} label={t('settings.booking.roads.switch')}
          hint={t(!owner ? 'settings.booking.roads.ownerOnly' : on ? 'settings.booking.roads.onHint' : 'settings.booking.roads.offHint')} data-testid="roads-switch" />
        <StateOf status={status} rush={rushOn} onRetry={() => void load()} />
        {run && <Progress run={run} />}
        {!run && mayMeasure && (
          <div class="row-wrap">
            <Button icon={<Route size={18} />} disabled={busy || behind} onClick={() => void measureNow(who, top)} data-testid="roads-measure">{t('settings.booking.roads.measure')}</Button>
            {behind && <span class="small muted grow" data-testid="roads-background">{t('settings.booking.roads.background')}</span>}
          </div>
        )}
        {last?.note && (
          <Banner kind={last.note.kind} title={last.note.title} data-testid="roads-message"
            action={<Button size="sm" variant="ghost" onClick={() => keep(who, null, last.out)} data-testid="roads-message-close">{t('common.close')}</Button>}>
            {last.note.title ? <><br />{last.note.text}</> : last.note.text}
          </Banner>
        )}
        {last?.out && last.out.late.length > 0 && <LateList ids={last.out.late} onClose={() => keep(who, last.note, { ...last.out!, late: [] })} />}
        {last?.out && last.out.kept.length > 0 && <KeptList list={last.out.kept} on={last.out.on} onClose={() => keep(who, last.note, { ...last.out!, kept: [] })} />}
        <Switch checked={d.roads_rush} onChange={(v) => set((x) => ({ ...x, roads_rush: v }))} label={t('settings.booking.roads.rush')}
          hint={t('settings.booking.roads.rushHint')} data-testid="roads-rush" />
        <div class="settings-grid-3">
          {ROADS.map((n) => {
            // the month's TomTom ceiling and the public page's allowance are money: the owner's, like the switch and
            // Branchements (review R2; roads_web_tx: decision of 2026-11-20 19:20)
            const locked = (n.k === 'roads_month_tx' || n.k === 'roads_web_tx') && !owner;
            return (
              <Field key={n.k} label={t(`settings.booking.${n.label}`)} help={t(`settings.booking.${n.label}Help`)} error={err[n.k]}
                hint={locked ? t('settings.booking.roads.ownerOnly') : undefined}>
                <NumInput value={d[n.k]} onValue={(v) => { set((x) => ({ ...x, [n.k]: v })); clear(n.k); }} disabled={locked}
                  unit={unitOf(n.unit)} invalid={!!err[n.k]} aria-label={t(`settings.booking.${n.label}`)} data-testid={`booking-${n.k}`} />
              </Field>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

/** the server's key, the trips still to measure, this month's spend (or why it cannot be said) */
function StateOf(p: { status: RoadsStatus | null; rush: boolean; onRetry: () => void }) {
  const s = p.status;
  if (!s) return <p class="small muted" style={{ margin: 0 }} data-testid="roads-loading">{t('settings.booking.roads.loading')}</p>;
  if (!s.ok) {
    return (
      <Banner kind="warn" title={t('settings.booking.roads.stateFailed')} data-testid="roads-error"
        action={<Button size="sm" onClick={p.onRetry} data-testid="roads-retry">{t('common.retry')}</Button>}>
        <br />{failWords(s, other)}
      </Banner>
    );
  }
  const l = lang.value;
  const nf = (n: number) => n.toLocaleString(l === 'en' ? 'en-CA' : 'fr-CA');
  // rush-hour trips listed that only TomTom measures, and TomTom cannot now: only the usual hours count as « à mesurer » (R3)
  const never = p.rush && s.left > s.left0 ? rushBlockedNow(s) : null;
  const leftWords = never ? t('settings.booking.roads.leftUsualOnly', { n: s.left0 })
    : s.left === 0 ? t('settings.booking.roads.leftNone') : t('settings.booking.roads.leftN', { n: nf(s.left), m: nf(s.left0) });
  return (
    <div class="stack" data-testid="roads-state">
      <Kv items={[
        [t('settings.booking.roads.stateKey'), <span data-testid="roads-key">{t(s.key ? 'settings.booking.roads.keyYes' : 'settings.booking.roads.keyNo')}</span>],
        [t('settings.booking.roads.stateLeft'), <span data-testid="roads-left">{leftWords}</span>],
        [t('settings.booking.roads.stateMonth'), <span data-testid="roads-month">{s.month ? t('settings.booking.roads.monthUsed', { tx: nf(s.month.tx), cap: nf(s.month.cap) }) : '—'}</span>]
      ]} />
      {!s.key && <p class="small muted" style={{ margin: 0 }} data-testid="roads-nokey">{t('settings.booking.roads.fail.noKey')}</p>}
      {never && <p class="small muted" style={{ margin: 0 }} data-testid="roads-rush-never">{t(never === 'cap' ? 'settings.booking.roads.rushNeedsCap' : 'settings.booking.roads.rushNeedsKey')}</p>}
    </div>
  );
}

/** a measure under way: what is measured and what is left, a bar, « Arrêter » */
function Progress(p: { run: Run }) {
  const pr = p.run.progress;
  const left = pr ? pr.todo : null;
  const top = Math.max(p.run.top, left ?? 0, 1);
  const switching = p.run.kind === 'off' || p.run.phase === 'switch';
  const words = !pr ? t(switching ? 'settings.booking.roads.switching' : 'settings.booking.roads.measuringStart')
    : t(p.run.goal === 'usual' ? 'settings.booking.roads.measuringUsual' : 'settings.booking.roads.measuring', { n: pr.stored, left: left ?? 0 });
  return (
    <div class="stack" role="status" aria-live="polite" data-testid="roads-progress">
      <div class="row-wrap">
        <span class="grow">{words}</span>
        {!switching && <Button size="sm" variant="ghost" icon={<Square size={16} />} onClick={() => { stopAsked = true; }} data-testid="roads-stop">{t('settings.booking.roads.stop')}</Button>}
      </div>
      <Meter value={left == null ? 0.04 : Math.max(0.04, 1 - left / top)} label={words} />
    </div>
  );
}

/** after the switch (or a measure with the switch on): the customers now later than the moment they were told */
function LateList(p: { ids: string[]; onClose: () => void }) {
  const l = lang.value;
  const list = lateRows(p.ids, jobOf, customer, customerName, l);
  return (
    <Banner kind="warn" title={t('settings.booking.roads.lateTitle', { n: list.length })} data-testid="roads-late"
      action={<Button size="sm" variant="ghost" onClick={p.onClose} data-testid="roads-late-close">{t('common.close')}</Button>}>
      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
        {list.map((r) => {
          const tel = r.phone ? e164(r.phone) || r.phone : '';
          return (
            <li key={r.id} class="row-wrap" data-testid="roads-late-row">
              <span class="grow"><b>{r.name}</b><br />
                <span class="small muted">{r.told && <>{t('settings.booking.roads.lateTold', { told: r.told })}</>}
                  {r.told && r.eta != null && ' · '}{r.eta != null && t('settings.booking.roads.lateEta', { eta: clock(r.eta, l) })}</span></span>
              {tel
                ? <>
                    <Button size="sm" icon={<Phone size={16} />} href={`tel:${tel}`}>{t('common.call')}</Button>
                    <Button size="sm" icon={<MessageSquare size={16} />} href={smsHref(r.phone, lateText(r))}>{t('settings.booking.win.untoldText')}</Button>
                  </>
                : <span class="small muted">{t('settings.booking.win.untoldNoPhone')}</span>}
            </li>
          );
        })}
      </ul>
    </Banner>
  );
}

/** the blocks the server did not plan again (an appointment would have gone to « À placer »): kept, their arrival times
    written again with the times of the mode (the real roads on, the estimate off) */
function KeptList(p: { list: RoadsOutcome['kept']; on: boolean; onClose: () => void }) {
  const l = lang.value;
  return (
    <Banner kind="warn" title={t(p.on ? 'settings.booking.roads.keptTitle' : 'settings.booking.roads.keptTitleOff', { n: p.list.length })} data-testid="roads-kept"
      action={<Button size="sm" variant="ghost" onClick={p.onClose} data-testid="roads-kept-close">{t('common.close')}</Button>}>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {p.list.map((k) => <li key={`${k.day}-${k.block}`}>{keptWords(k, l)}</li>)}
      </ul>
    </Banner>
  );
}
