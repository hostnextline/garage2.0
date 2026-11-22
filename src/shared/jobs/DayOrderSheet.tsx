/* « Réorganiser la journée » (Part 28; the owner: « i want to be able to easely rearange a day », he chose « Drag in a
   list »; REARRANGE.md §2). Every truck's stops of the day in a list: a stop dragged up, down or onto the other truck by
   its grip ≡ (a mouse: the whole row), or moved from its menu (a tap on the row) or the keyboard; the arrival times are
   the SERVER's, asked 600 ms after the last change (day_order_preview, nothing written); who would change hour, be late
   or early is said before anything is saved; NOTHING changes until « Enregistrer », and no text goes (« Envoyer les
   heures aux clients », once the day is done, is the owner's one button).
   - Opening (switch « Vraies routes » on, owner / office): the day's trips are measured first (a trip stored then
     re-plans that day), then one preview of the day as it is: every row shows the server's arrival from the start.
   - « Enregistrer »: the preview for this exact draft first; a new window, someone late or early, a pin that goes or a
     truck past its hours → shown, the button becomes « Enregistrer quand même »; the save refuses any other outcome than
     the one shown (outcome_changed, then redrawn from its detail). One op per press; a deadlock: once more after 1 s with
     the same op; no answer: the same call again (the server answers what it saved), then « Pas enregistré ».
   - Someone else changed the day (realtime, another phone, « Je pars », a cancel): the screen rebases — the server's
     rows for every stop NOT moved, the person's moves kept (domain/jobs/dayOrder.ts rebase), the person who saved named.
   - The draft is kept on the phone (an iPhone home-screen app reloads after a call) until saved or left.
   - « Laisser l'app choisir »: the planner's order as a draft, saved only by « Enregistrer ».
   The data: the phone's rows (jobsOn), never the Carte's team_map. The server's names: src/data/dayOrder.ts. The moves:
   src/domain/jobs/dayOrder.ts. The gesture: ./listDrag.ts. Opened by ./DayOrderHost.tsx (openDayOrder). */
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUp, CircleCheck, Send, Truck as TruckIcon, Undo2, Wand2 } from 'lucide-preact';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { addDays, clock, clockRange, dayOf, duration, longDay, minuteOf, nowMinute, tinyDay, today, type BlockKey } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { allJobs, blockOfKey, jobsOn, roadsOn, settings, trucks as allTrucks, truckLabel } from '../../data/select';
import { me } from '../../data/auth';
import { net, pendingOps, pull, uuid } from '../../data/sync';
import { roadsTick, warmRoads } from '../../data/roads';
import {
  DAY_ORDER_DEADLOCK_RETRY_MS, DAY_ORDER_LOCK_RETRY_MS, DAY_ORDER_WAIT_MS, dayAnswer, dayOrderPreview, dayOrderSave, dayRefusal, dropDraft,
  isDeadlock, isLockBusy, isNoAnswer, keepDraft, keptDraft, needsConfirm, type DayAnswer, type DayOrderAsk, type DayRefusal, type DayStop
} from '../../data/dayOrder';
import {
  backToPlace, blocksOf, canDrop, changed, changedTrucks, draftOf, dropIndex, kindOfTruck, listOf, listsOf, moveBy, moveTo, movedOf,
  ordersAll, placeOf, putFirst, rebase, trucksOf, wasKey, wasOf, withLists, worksOn, END, type DayList, type Draft, type DropCtx
} from '../../domain/jobs/dayOrder';
import { clientsDue, tellCtx } from '../../domain/jobs/told';
import { Sheet, Button, Banner, Pill, Help, toast, dismissToast, ask, whenHistorySettled } from '../../ui';
import { etaUnsure, jobFirstName, jobName } from './select';
import { moveWaiting } from './moving';
import { createListDrag, type DropAt } from './listDrag';
import { PREVIEW_WAIT_MS } from './exactMove';
import { openTell } from './TellHost';
import { ToldBanner } from './ToldBanner';
import './jobs.css';
import './dayorder.css';

/** where the sheet was opened from: the day, the truck to show first, the job ringed (and put first) */
export interface DayOrderAt { day: string; truck?: string | null; job?: string; first?: boolean }

type AskState = 'idle' | 'asking' | 'none' | 'refused';
type SaveState = 'idle' | 'checking' | 'saving' | 'lost' | 'lostNot' | 'busy';
interface Notice { kind: 'info' | 'warn' | 'ok'; text: string; action?: 'forget' | 'autoBack'; testid: string }

/** what is sent for a draft */
const askOf = (d: Draft): DayOrderAsk => ({ day: d.day, lists: listsOf(d), moved: movedOf(d), was: d.was, auto: d.auto });
/** the key of a draft's preview (a measure landed: asked again) */
const keyOf = (d: Draft, tick: number) => JSON.stringify([listsOf(d), movedOf(d), wasKey(d.was), d.auto, tick]);
const names = (xs: string[]) => xs.filter(Boolean).join(', ');
/** the minute of the evening lock (settings.booking.win_lock_min, 18 h by default) */
function lockMinute(): number {
  const v = (settings.value.booking as { win_lock_min?: unknown }).win_lock_min;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 1080;
}
/** today, or tomorrow once the evening lock is past (win_lock_due): a flexible stop gets its window at the save */
const lockDue = (day: string) => day === today() || (day === addDays(today(), 1) && nowMinute() >= lockMinute());

export function DayOrderSheet(p: { at: DayOrderAt; onClose: () => void; onSaved?: () => void }) {
  const day = p.at.day;
  const l = lang.value;
  const book = ordersAll();
  const staffId = me.value?.id || '';
  const online = net.value.online;
  const tick = roadsTick.value;
  const rows = jobsOn(day);
  const byId = useMemo(() => new Map(rows.map((j) => [j.id, j])), [rows]);
  const rowOf = (id: string): Job | undefined => byId.get(id);

  /* ---------- the draft ---------- */
  const start = () => {
    const d = draftOf(rows, trucksOf(day, rows), day, blocksOf());
    return p.at.first && p.at.job ? putFirst(d, p.at.job) : d;
  };
  const [draft, setDraftState] = useState<Draft>(start);
  const draftRef = useRef(draft);
  const setDraft = (d: Draft) => { draftRef.current = d; setDraftState(d); };
  const [ready, setReady] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preAuto, setPreAuto] = useState<Draft | null>(null);
  const [picked, setPicked] = useState<{ id: string; before: Draft } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const dirty = changed(draft);
  const key = keyOf(draft, tick);

  /* ---------- the server's times ---------- */
  const memo = useRef(new Map<string, DayAnswer>());
  const seq = useRef(0);
  const [ans, setAns] = useState<{ key: string; a: DayAnswer } | null>(null);
  const [asking, setAsking] = useState<AskState>('idle');
  const [refusal, setRefusal] = useState<{ key: string; r: DayRefusal; words: string } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const busy = useRef(false);
  const rebasing = useRef(false);
  const cur = ans && ans.key === key ? ans.a : null;
  const ref = refusal && refusal.key === key ? refusal : null;

  const take = (k: string, a: DayAnswer) => { memo.current.set(k, a); setAns({ key: k, a }); setAsking('idle'); setRefusal(null); };
  async function askPreview(k: string, d: Draft, again = false): Promise<void> {
    const my = ++seq.current;
    setAsking('asking');
    const late = setTimeout(() => { if (seq.current === my && alive.current) setAsking('none'); }, PREVIEW_WAIT_MS);
    try {
      const a = await dayOrderPreview(askOf(d));
      clearTimeout(late);
      if (seq.current !== my || !alive.current) return;
      if (!a) { setAsking('none'); return; }
      if (a.kind === 'basis') { setAsking('idle'); void rebaseNow(a.by); return; }
      take(k, a);
    } catch (e) {
      clearTimeout(late);
      if (seq.current !== my || !alive.current) return;
      // a job row another action held (a cancel, a « Client absent »): the preview gave up first; once more, then none
      if (isLockBusy(e) && !again) { setTimeout(() => { if (seq.current === my && alive.current) void askPreview(k, d, true); }, DAY_ORDER_LOCK_RETRY_MS); return; }
      const r = dayRefusal(e);
      if (r && (r.code === 'changed' || r.code === 'day_changed')) { setAsking('idle'); void rebaseNow(r.by ?? undefined); return; }
      if (r) { setRefusal({ key: k, r, words: refusalWords(r, e) }); setAsking('refused'); return; }
      setAsking('none');
    }
  }
  // asked 600 ms after the LAST change (at once when the sheet opens), never during a gesture or a save
  useEffect(() => {
    if (!ready || !online || picked || saveState === 'saving' || saveState === 'checking') return;
    const hit = memo.current.get(key);
    if (hit) { setAns({ key, a: hit }); setAsking('idle'); return; }
    if (refusal?.key === key) return;
    const d = draft;
    const tm = setTimeout(() => { void askPreview(key, d); }, ans ? DAY_ORDER_WAIT_MS : 0);
    return () => clearTimeout(tm);
  }, [key, ready, online, !!picked, saveState]);

  /* ---------- opening: the day's trips measured first, the kept draft back ---------- */
  useEffect(() => {
    void (async () => {
      if (roadsOn.value && book && net.value.online) {
        setMeasuring(true);
        try { await warmRoads(null, day, 1); } catch { /* not measured: the times say so */ }
        if (!alive.current) return;
        setMeasuring(false);
      }
      const now = jobsOn(day);
      const trucks = trucksOf(day, now);
      let d = draftRef.current;
      d = changed(d) ? rebase(d, now, trucks, blocksOf()).draft : draftOf(now, trucks, day, blocksOf());
      const kept = day >= today() ? keptDraft(staffId, day) : null;
      if (kept) {
        const back = rebase({ day, lists: kept.lists.map((x) => ({ ...x, block: x.block as BlockKey })), moved: kept.moved, auto: false }, now, trucks, blocksOf()).draft;
        if (changed(back)) {
          d = back;
          const at = minuteOf(new Date(kept.at));
          setNotice({ kind: 'info', text: t('reorg.draftBack', { time: Number.isFinite(at) ? clock(at, l) : '' }), action: 'forget', testid: 'dayorder-draft-back' });
        } else dropDraft(staffId, day);
      }
      setDraft(d);
      setReady(true);
      if (p.at.truck) setTimeout(() => showTruck(p.at.truck!), 0);
    })();
  }, []);

  // the unsaved order kept on the phone after each change (dropped once it is the day as it is again)
  useEffect(() => {
    if (!ready) return;
    if (changed(draft)) keepDraft(staffId, day, { was: draft.was, lists: listsOf(draft), moved: draft.moved, auto: draft.auto, at: new Date().toISOString() });
    else dropDraft(staffId, day);
  }, [draft, ready]);

  /* ---------- someone else changed the day ---------- */
  const basisNow = wasKey(wasOf(rows, draft.lists.map((x) => x.truck).filter((x, i, a) => a.indexOf(x) === i), day));
  useEffect(() => {
    if (!ready || busy.current || rebasing.current) return;
    if (basisNow !== wasKey(draft.was)) void rebaseNow(undefined);
  }, [basisNow, ready]);

  /** the draft on the server's rows now, the person's moves kept; `by`: who saved meanwhile (undefined: ask it) */
  async function rebaseNow(by: string | null | undefined): Promise<void> {
    if (rebasing.current) return;
    rebasing.current = true;
    try {
      let who = by;
      const before = draftRef.current;
      // nobody named yet: one preview with the OLD basis says who saved the day meanwhile (days F2)
      if (who === undefined && changed(before) && net.value.online) {
        try { const a = await dayOrderPreview(askOf(before)); who = a?.kind === 'basis' ? a.by : null; } catch { who = null; }
      }
      try { await pull('jobs'); } catch { /* the phone's rows as they are */ }
      await new Promise<void>((done) => drag.afterDrag(done));
      if (!alive.current) return;
      setPicked(null);
      const d = draftRef.current;
      const now = jobsOn(day);
      const r = rebase(d, now, trucksOf(day, now), blocksOf());
      setDraft(r.draft);
      const name = (id: string) => { const j = now.find((x) => x.id === id) || byId.get(id); return j ? jobFirstName(j) : ''; };
      const what = [
        ...r.what.started.map((id) => t('reorg.started', { name: name(id) })),
        ...r.what.added.map((id) => t('reorg.added', { name: name(id) })),
        ...r.what.gone.map((id) => t('reorg.gone', { name: name(id) })),
        ...r.what.moved.map((id) => t('reorg.moved', { name: name(id) }))
      ].filter((x) => !/^\s/.test(x));
      if (d.auto) { setPreAuto(null); setNotice({ kind: 'info', text: t('reorg.autoLost'), testid: 'dayorder-auto-lost' }); }
      else if (who && r.draft.moved.length) setNotice({ kind: 'info', text: t('reorg.changedBy', { name: who, n: r.draft.moved.length }), testid: 'dayorder-changed' });
      else if (what.length) setNotice({ kind: 'info', text: t('reorg.changed', { what: what.join(', ') }), testid: 'dayorder-changed' });
    } finally {
      rebasing.current = false;
    }
  }

  /* ---------- where a stop may go ---------- */
  const dayTrucks = draft.lists.map((x) => x.truck).filter((x, i, a) => a.indexOf(x) === i);
  const dropCtx = (): DropCtx => ({
    book, works: (tr, b) => worksOn(tr, day, b),
    trucks: dayTrucks.map((id) => ({ id, tire_machine: allTrucks.value.find((x) => x.id === id)?.tire_machine }))
  });
  const whyWords = (why: string, truck: string) => why === 'machine' ? t('reorg.cannotMachine') : why === 'off' ? t('reorg.cannotOff', { truck: truckLabel(truck) })
    : why === 'right' ? t('reorg.cannotRight') : t('reorg.otherBlock');
  /** a drop onto the other kind of vehicle is asked first: it then stays on that kind for every later plan */
  const askKind = (id: string, truck: string) => {
    const j = rowOf(id);
    const k = kindOfTruck(dropCtx().trucks, truck);
    return ask({ title: t(k === 'car' ? 'reorg.kindToCar' : 'reorg.kindToTruck', { name: j ? jobFirstName(j) : '' }), ok: t('reorg.kindOk'), cancel: t('reorg.cancel') });
  };
  /** a move made: the draft, and the words for a screen reader */
  function put(next: Draft, id: string) {
    if (next === draftRef.current) return;
    setDraft(next);
    setRefusal(null);
    const pl = placeOf(next, id);
    const list = pl ? listOf(next, pl.truck, pl.block) : undefined;
    const j = rowOf(id);
    if (pl && list && j) setSaid(t('reorg.placed', { name: jobName(j), pos: list.live.length + pl.index + 1, n: list.live.length + list.jobs.length, truck: truckLabel(pl.truck) }));
  }
  /** onto that truck (that block) at that place, after the question of the other kind when it is one */
  async function placeOn(id: string, truck: string, block: BlockKey, index: number): Promise<void> {
    const d = draftRef.current;
    const why = canDrop(d, rowOf(id) ?? { id }, truck, block, dropCtx());
    if (why && why !== 'kind') { toast(whyWords(why, truck), { kind: 'bad', ms: 4000 }); return; }
    if (why === 'kind' && !(await askKind(id, truck))) return;
    put(moveTo(draftRef.current, id, truck, block, index), id);
  }

  /* ---------- the drag ---------- */
  const body = useRef<HTMLElement | null>(null);
  // the gesture lives as long as the sheet: it reads the helpers of the latest drawing (rows and trucks change)
  const latest = useRef({ rowOf, dropCtx, placeOn, whyWords });
  latest.current = { rowOf, dropCtx, placeOn, whyWords };
  const drag = useMemo(() => createListDrag({
    body: () => body.current ?? (document.querySelector('[data-testid="dayorder-sheet"] .sheet-body') as HTMLElement | null),
    blockOf: (id) => placeOf(draftRef.current, id)?.block ?? null,
    check: (id, truck, block) => {
      const h = latest.current;
      const r = canDrop(draftRef.current, h.rowOf(id) ?? { id }, truck, block as BlockKey, h.dropCtx());
      return r && r !== 'kind' ? r : null;
    },
    drop: (id, at: DropAt) => {
      const d = draftRef.current;
      const list = listOf(d, at.truck, at.block as BlockKey);
      if (!list) return;
      void latest.current.placeOn(id, at.truck, at.block as BlockKey, dropIndex(d, id, at.truck, at.block as BlockKey, Math.min(at.index, list.jobs.length)));
    },
    refused: (_id, why, at) => toast(latest.current.whyWords(why, at.truck), { kind: 'bad', ms: 4000 }),
    toTruck: (truck) => showTruck(truck)
  }), []);
  useEffect(() => () => drag.cancel(), []);
  const dragging = drag.dragging.value;
  const target = drag.target.value;
  /** that truck's heading right under the sticky band (its real height: the band is taller with three trucks); during a
      drag at once, so nothing can beat it (review F1, F2) */
  function showTruck(truck: string) {
    const el = document.querySelector(`[data-dayord-truck="${truck}"]`) as HTMLElement | null;
    const b = body.current;
    if (!el) return;
    if (!b || typeof b.scrollTo !== 'function') { el.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); return; }
    const band = b.querySelector('.dayord-sticky')?.getBoundingClientRect().height ?? 0;
    const top = b.scrollTop + el.getBoundingClientRect().top - b.getBoundingClientRect().top - band - 8;
    b.scrollTo({ top: Math.max(0, top), behavior: drag.active() ? 'auto' : 'smooth' });
  }

  /* ---------- a move shifts the rows in 120 ms, the app's whole order in 200 ms (none under « Réduire les animations »:
     base.css; never the dragged one) ---- */
  const tops = useRef(new Map<string, number>());
  const shiftMs = useRef(120);
  useLayoutEffect(() => {
    const b = body.current;
    if (!b) return;
    const top0 = b.getBoundingClientRect().top - b.scrollTop;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    b.querySelectorAll<HTMLElement>('[data-dayord-row]').forEach((el) => {
      const id = el.dataset.id || '';
      const y = el.getBoundingClientRect().top - top0;
      next.set(id, y);
      const was = tops.current.get(id);
      if (still || was == null || Math.abs(was - y) < 1 || el.classList.contains('is-dragging')) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${Math.round(was - y)}px)`;
      void el.offsetHeight;                                                          // the start, drawn once
      el.style.transition = shiftMs.current === 120 ? '' : `transform ${shiftMs.current}ms var(--ease)`;
      el.style.transform = '';
    });
    tops.current = next;
    shiftMs.current = 120;
  }, [draft]);

  /* ---------- the keyboard (the grip is a button: the HoursGrid model) ---------- */
  /** a stop put back with Escape: its grip keeps the focus once redrawn in its own truck (review F9) */
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const id = picked?.id ?? refocus.current;
    refocus.current = null;
    if (!id) return;
    (document.querySelector(`[data-dayord-grip="${id}"]`) as HTMLElement | null)?.focus();
  }, [picked, draft]);
  function onGripKey(e: KeyboardEvent, id: string) {
    const j = rowOf(id);
    if (!j) return;
    if (picked?.id !== id) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        setPicked({ id, before: draftRef.current });
        setSaid(t('reorg.picked', { name: jobName(j) }));
      }
      return;
    }
    const d = draftRef.current;
    const pl = placeOf(d, id);
    if (!pl) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { stop(); put(moveBy(d, id, e.key === 'ArrowUp' ? -1 : 1), id); return; }
    if (e.key === 'Home' || e.key === 'End') { stop(); put(moveTo(d, id, pl.truck, pl.block, e.key === 'Home' ? 0 : END), id); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      stop();
      const i = dayTrucks.indexOf(pl.truck) + (e.key === 'ArrowLeft' ? -1 : 1);
      const to = dayTrucks[i];
      if (!to) return;
      const why = canDrop(d, j, to, pl.block, dropCtx());
      if (why && why !== 'kind') { toast(whyWords(why, to), { kind: 'bad', ms: 4000 }); return; }
      put(moveTo(d, id, to, pl.block, pl.index), id);
      return;
    }
    if (e.key === 'Escape') { stop(); refocus.current = id; setDraft(picked.before); setPicked(null); setSaid(t('reorg.putBack', { name: jobName(j) })); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      stop();
      const before = picked.before;
      setPicked(null);
      // put down on the other kind of vehicle: asked as a drop would be (not when it already was on that vehicle)
      const home = before.base[id]?.truck;
      const was = placeOf(before, id)?.truck;
      if (home && pl.truck !== home && pl.truck !== was && kindOfTruck(dropCtx().trucks, pl.truck) !== kindOfTruck(dropCtx().trucks, home)) {
        void askKind(id, pl.truck).then((ok) => { if (!ok) setDraft(before); });
      }
      setSaid(t('reorg.placed', { name: jobName(j), pos: (listOf(d, pl.truck, pl.block)?.live.length ?? 0) + pl.index + 1, n: (listOf(d, pl.truck, pl.block)?.live.length ?? 0) + (listOf(d, pl.truck, pl.block)?.jobs.length ?? 0), truck: truckLabel(pl.truck) }));
    }
  }

  /* ---------- waiting on the phone, no network ---------- */
  const waitMove = rows.some((j) => moveWaiting(j.id)) || pendingOps((e) => e.kind === 'rpc' && e.rpc === 'move_job' && e.args?.p_day === day).length > 0;

  /* ---------- « Enregistrer » ---------- */
  const saving = saveState === 'saving' || saveState === 'checking';
  const confirm = !!cur && needsConfirm(cur);
  const canSave = dirty && online && !waitMove && !ref && !saving && !picked && !dragging && ready;
  async function save(anyway: boolean): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    try {
      const d = draftRef.current;
      const k = keyOf(d, roadsTick.value);
      let a: DayAnswer | null = ans && ans.key === k ? ans.a : null;
      if (!a) {
        // the times of THIS draft first (« Vérification… »); no answer: the save judges by itself
        setSaveState('checking');
        seq.current++;
        try {
          const got = await dayOrderPreview(askOf(d));
          if (got?.kind === 'basis') { setSaveState('idle'); void rebaseNow(got.by); return; }
          if (got) { take(k, got); a = got; }
        } catch (e) {
          const r = dayRefusal(e);
          if (r && (r.code === 'changed' || r.code === 'day_changed')) { setSaveState('idle'); void rebaseNow(r.by ?? undefined); return; }
          if (r) { setRefusal({ key: k, r, words: refusalWords(r, e) }); setAsking('refused'); setSaveState('idle'); return; }
        }
        if (a && needsConfirm(a)) { setSaveState('idle'); return; }          // the verdict is shown: one more tap
      } else if (needsConfirm(a) && !anyway) { setSaveState('idle'); return; }
      setSaveState('saving');
      const op = uuid();
      const accept = a ? a.acceptRaw : {};
      const once = () => dayOrderSave(askOf(d), accept, op);
      let r: Awaited<ReturnType<typeof dayOrderSave>> | undefined;
      try {
        r = await once();
      } catch (e) {
        if (isDeadlock(e)) {
          await new Promise((x) => setTimeout(x, DAY_ORDER_DEADLOCK_RETRY_MS));
          try { r = await once(); } catch (e2) { if (isDeadlock(e2)) { setSaveState('busy'); return; } if (!refused(e2, k)) setSaveState(isNoAnswer(e2) ? 'lostNot' : 'idle'); return; }
        } else if (isNoAnswer(e)) {
          // the answer may be lost after the server saved: the SAME op once more (op_begin answers what it saved)
          setSaveState('lost');
          try { r = await once(); } catch (e3) { if (!refused(e3, k)) setSaveState(isNoAnswer(e3) || isDeadlock(e3) ? 'lostNot' : 'idle'); return; }
        } else { if (!refused(e, k)) setSaveState('idle'); return; }
      }
      if (!alive.current) return;
      if (!r || r.kind !== 'answer') { if (r?.kind === 'basis') void rebaseNow(r.by); setSaveState('idle'); return; }
      saved();
    } finally {
      busy.current = false;
    }
  }
  /** a refusal of the save, shown (true); false: not a refusal */
  function refused(e: unknown, k: string): boolean {
    const r = dayRefusal(e);
    if (!r) return false;
    setSaveState('idle');
    if (r.code === 'outcome_changed') {
      // the detail is the whole answer: everything redrawn from it, the button as it now says
      const a = dayAnswer(r.detail);
      if (a && a.kind === 'answer') take(k, a);
      setNotice({ kind: 'warn', text: t('reorg.outcome'), testid: 'dayorder-outcome' });
      return true;
    }
    if (r.code === 'day_changed' || r.code === 'changed') { void rebaseNow(r.by ?? undefined); return true; }
    setRefusal({ key: k, r, words: refusalWords(r, e) });
    setAsking('refused');
    return true;
  }
  /** « Journée enregistrée. Aucun texto n'est parti. »: taken away once the send list opens (it would still be up above
      « 4 textos partis »: review F7) */
  const savedToast = useRef<number | null>(null);
  const sendList = () => {
    if (savedToast.current != null) { dismissToast(savedToast.current); savedToast.current = null; }
    openTell(day);
  };
  function saved() {
    dropDraft(staffId, day);
    memo.current.clear();
    setAns(null);
    setRefusal(null);
    setPreAuto(null);
    setNotice(null);
    setSaveState('idle');
    // the answer's rows are on the phone already (every block of the day): the sheet stays on the saved day
    const now = jobsOn(day);
    setDraft(draftOf(now, trucksOf(day, now), day, blocksOf()));
    savedToast.current = toast(t('reorg.saved'), { kind: 'ok', ms: 6000 });
    p.onSaved?.();
  }
  function refusalWords(r: DayRefusal, e: unknown): string {
    if (r.code === 'truck_ends' && r.truck) {
      const j = r.jobs.map((id) => rowOf(id)).find(Boolean);
      return t('reorg.cannotEnds', { truck: truckLabel(r.truck), time: r.ends != null ? clock(r.ends, l) : '', name: j ? jobFirstName(j) : '' });
    }
    if (r.code === 'truck_off' && r.truck) return t('reorg.cannotOff', { truck: truckLabel(r.truck) });
    return errorMessage(e);
  }

  /* ---------- « Laisser l'app choisir » ---------- */
  async function autoChoose(): Promise<void> {
    if (!(await ask({ title: t('reorg.autoTitle'), text: t('reorg.autoText'), ok: t('reorg.autoOk'), cancel: t('reorg.autoKeep') }))) return;
    const d = draftRef.current;
    setSaveState('checking');
    try {
      const a = await dayOrderPreview({ day, lists: null, moved: [], was: d.was, auto: true });
      if (!alive.current) return;
      if (a?.kind === 'basis') { void rebaseNow(a.by); return; }
      if (!a) { toast(t('reorg.sumNoAnswer'), { kind: 'bad' }); return; }
      const next = withLists(d, a.lists);
      setPreAuto(d);
      shiftMs.current = 200;
      setDraft(next);
      take(keyOf(next, roadsTick.value), a);
      setNotice({ kind: 'info', text: t('reorg.autoShown'), testid: 'dayorder-auto-shown' });
    } catch (e) {
      const r = dayRefusal(e);
      toast(r ? refusalWords(r, e) : t('reorg.sumNoAnswer'), { kind: 'bad' });
    } finally {
      if (alive.current) setSaveState('idle');
    }
  }
  const autoBack = () => { if (preAuto) setDraft(preAuto); setPreAuto(null); setNotice(null); };
  const forget = () => {
    dropDraft(staffId, day);
    setNotice(null);
    const now = jobsOn(day);
    setDraft(draftOf(now, trucksOf(day, now), day, blocksOf()));
  };

  /* ---------- leaving ---------- */
  async function tryClose(): Promise<void> {
    if (saving) return;
    drag.cancel();
    if (changed(draftRef.current)) {
      if (!(await ask({ title: t('reorg.leaveTitle'), text: t('reorg.leaveText'), ok: t('reorg.leave'), cancel: t('reorg.stay'), danger: true }))) return;
      dropDraft(staffId, day);
    }
    whenHistorySettled(p.onClose);
  }

  /* ---------- drawing ---------- */
  const trucksChanged = changedTrucks(draft);
  const count = draft.lists.reduce((n, x) => n + x.live.length + x.jobs.length, 0);
  const unplaced = rows.filter((j) => j.status === 'booked' && !j.truck_id).length;
  const n = book && !dirty ? clientsDue(day, allJobs.value, tellCtx()) : 0;
  const blocksMode = !draft.lists.every((x) => x.block === 'day');
  const sum = dirty ? summaryOf() : null;

  function summaryOf(): { tone: 'warn' | 'ok' | 'muted'; text: string; first: string | null; retry?: boolean } | null {
    if (saveState === 'lost') return { tone: 'warn', text: t('reorg.lost'), first: null };
    if (saveState === 'lostNot') return { tone: 'warn', text: t('reorg.lostNot'), first: null };
    if (saveState === 'busy') return { tone: 'warn', text: t('reorg.busy'), first: null };
    if (saveState === 'saving') return { tone: 'muted', text: t('reorg.saving'), first: null };
    if (saveState === 'checking') return { tone: 'muted', text: t('reorg.checking'), first: null };
    if (ref) return { tone: 'warn', text: ref.words, first: ref.r.jobs[0] ?? null };
    // no network: the banner above the lists says it (never twice on one screen: review F7)
    if (!online) return null;
    if (!cur) return asking === 'none' ? { tone: 'warn', text: t('reorg.sumNoAnswer'), first: null, retry: true } : { tone: 'muted', text: t('reorg.sumAsking'), first: null };
    const first = (m: Record<string, number>) => Object.keys(m);
    const fn = (xs: string[]) => names(xs.map((id) => { const j = rowOf(id); return j ? jobFirstName(j) : ''; }));
    const out: string[] = [];
    const w = first(cur.accept.windows), lt = first(cur.accept.late), er = first(cur.accept.early), pn = first(cur.accept.pins), ov = first(cur.accept.over);
    if (w.length) out.push(t('reorg.sumChanges', { n: w.length, names: fn(w) }));
    if (lt.length) out.push(t('reorg.sumLate', { n: lt.length, names: fn(lt) }));
    if (er.length) out.push(t('reorg.sumEarly', { n: er.length, names: fn(er) }));
    if (pn.length) out.push(t('reorg.sumPins', { n: pn.length, names: fn(pn) }));
    if (ov.length) out.push(t('reorg.sumOver', { n: ov.length }));
    const un = cur.stops.filter((s) => s.measured === false && trucksChanged.has(s.truckId || '')).length;
    if (un) out.push(t('reorg.sumUnmeasured', { n: un }));
    if (!out.length) return { tone: 'ok', text: t('reorg.sumNone'), first: null };
    return { tone: w.length || lt.length || er.length || pn.length || ov.length ? 'warn' : 'muted', text: out.join(' '), first: [...w, ...lt, ...er, ...pn][0] ?? null };
  }
  const showRow = (id: string | null) => {
    if (!id) return;
    (document.querySelector(`[data-dayord-row][data-id="${id}"]`) as HTMLElement | null)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const footer = (
    <>
      {sum && (
        <div class={`dayord-sum is-${sum.tone}`} data-testid="dayorder-summary" role="status">
          {sum.tone === 'warn' ? <AlertTriangle aria-hidden="true" /> : sum.tone === 'ok' ? <CircleCheck aria-hidden="true" /> : null}
          {sum.first ? <span><button type="button" class="dayord-sum-go" onClick={() => showRow(sum.first)} data-testid="dayorder-summary-go">{sum.text}</button></span> : <span>{sum.text}</span>}
          {sum.retry && <Button size="sm" onClick={() => { memo.current.delete(key); void askPreview(key, draftRef.current); }} data-testid="dayorder-retry">{t('reorg.retry')}</Button>}
        </div>
      )}
      {!dirty ? (
        <>
          <Button onClick={p.onClose} data-testid="dayorder-close">{t('reorg.close')}</Button>
          {n > 0
            ? <Button variant="primary" icon={<Send size={18} />} onClick={sendList} data-testid="dayorder-send">{t('tell.button', { n })}</Button>
            : <Button variant="primary" disabled data-testid="dayorder-save">{t('reorg.save')}</Button>}
        </>
      ) : (
        <>
          <Button onClick={() => tryClose()} disabled={saving} data-testid="dayorder-cancel">{t('reorg.cancel')}</Button>
          <Button variant="primary" disabled={!canSave} busy={saving} onClick={() => save(confirm)} data-testid="dayorder-save">
            {saveState === 'saving' ? t('reorg.saving') : saveState === 'checking' ? t('reorg.checking') : confirm ? t('reorg.saveAnyway') : t('reorg.save')}
          </Button>
        </>
      )}
    </>
  );

  const date = longDay(day, l);
  return (
    <Sheet open wide onClose={() => void tryClose()} title={t('reorg.open')} sub={t('reorg.sub', { day: date.charAt(0).toUpperCase() + date.slice(1), n: count })}
      footer={footer} data-testid="dayorder-sheet">
      <div ref={(el) => { body.current = (el?.parentElement as HTMLElement | null) ?? null; }} class="dayord" data-day={day}>
        <div class="dayord-sticky" data-testid="dayorder-band">
          <div class="dayord-status" data-testid="dayorder-status">
            {dragging && target?.refused
              ? <span class="grow dayord-warn" role="status" data-testid="dayorder-band-refused">{whyWords(target.refused, target.truck)}</span>
              : dirty ? <span class="grow"><Pill tone="warn" data-testid="dayorder-unsaved">{t('reorg.unsaved')}</Pill></span> : <span class="grow" />}
            {book && (draft.auto && preAuto
              ? <Button size="sm" variant="ghost" icon={<Undo2 size={16} />} onClick={autoBack} disabled={saving} data-testid="dayorder-auto-back">{t('reorg.autoBack')}</Button>
              : <Button size="sm" variant="ghost" icon={<Wand2 size={16} />} onClick={() => autoChoose()} disabled={saving || !online || !ready} data-testid="dayorder-auto">{t('reorg.auto')}</Button>)}
          </div>
          {dayTrucks.length > 1 && (
            <div class="dayord-chips" role="group" aria-label={t('reorg.open')}>
              {dayTrucks.map((tr) => {
                const c = draft.lists.filter((x) => x.truck === tr).reduce((k, x) => k + x.live.length + x.jobs.length, 0);
                return (
                  <button key={tr} type="button" class={`dayord-chip${dragging && target?.truck === tr ? (target.refused ? ' is-refused' : ' is-over') : ''}`} data-dayord-chip data-truck={tr}
                    onClick={() => showTruck(tr)} data-testid={`dayorder-chip-${tr}`}><span>{truckLabel(tr)}</span> <b>{c}</b></button>
                );
              })}
            </div>
          )}
        </div>
        {!dirty && <p class="dayord-hint" data-testid="dayorder-hint">{t('reorg.hint')}</p>}
        <div class="dayord-notes">
          {!online && <Banner kind="warn" data-testid="dayorder-offline">{t('reorg.offline')}</Banner>}
          {measuring && <Banner kind="info" data-testid="dayorder-measuring">{t('reorg.measuring')}</Banner>}
          {waitMove && <Banner kind="warn" data-testid="dayorder-waitmove">{t('reorg.waitMove')}</Banner>}
          {notice && (
            <Banner kind={notice.kind} data-testid={notice.testid}
              action={notice.action === 'forget' ? <Button size="sm" onClick={forget} data-testid="dayorder-forget">{t('reorg.draftForget')}</Button> : undefined}>
              {notice.text}
            </Banner>
          )}
        </div>
        <div class="dayord-trucks">
          {dayTrucks.map((tr) => (
            <TruckPart key={tr} truck={tr} lists={draft.lists.filter((x) => x.truck === tr)} draft={draft} rows={rows} rowOf={rowOf} cur={cur} judge={dirty}
              changedHere={trucksChanged.has(tr)} asking={asking === 'none' || asking === 'refused' || !online ? asking : 'asking'} blocksMode={blocksMode} at={p.at} picked={picked?.id ?? null} refJobs={ref?.r.jobs ?? []}
              refTruck={ref?.r.truck ?? null} dragging={dragging} target={target} drag={drag} onGripKey={onGripKey}
              onTap={(id) => { if (!drag.justDragged()) setMenuFor(id); }} whyWords={whyWords} />
          ))}
        </div>
        {unplaced > 0 && <p class="dayord-note" data-testid="dayorder-unplaced">{t('reorg.unplaced', { n: unplaced })}</p>}
        {!dirty && ready && <ToldBanner day={day} onSend={sendList} />}
        <p id="dayord-keys" class="sr-only">{t('reorg.keys')}</p>
        <p class="sr-only" aria-live="polite" data-testid="dayorder-live">{said}</p>
      </div>
      {menuFor && (
        <RowMenu id={menuFor} draft={draft} job={rowOf(menuFor)} trucks={dayTrucks} book={book} ctx={dropCtx()} whyWords={whyWords}
          onClose={() => setMenuFor(null)}
          onFirst={() => put(putFirst(draftRef.current, menuFor), menuFor)}
          onMove={(delta) => put(moveBy(draftRef.current, menuFor, delta), menuFor)}
          onOn={(truck) => void placeOn(menuFor, truck, placeOf(draftRef.current, menuFor)?.block ?? 'day', END)}
          onBack={() => put(backToPlace(draftRef.current, menuFor), menuFor)} />
      )}
    </Sheet>
  );
}

/* ---------- one truck ---------- */

interface TruckProps {
  truck: string; lists: DayList[]; draft: Draft; rows: Job[]; rowOf: (id: string) => Job | undefined; cur: DayAnswer | null;
  /** something changed: the save's verdict is shown (nothing changed: only the server's times, nothing to save) */
  judge: boolean;
  changedHere: boolean; asking: AskState; blocksMode: boolean; at: DayOrderAt; picked: string | null; refJobs: string[]; refTruck: string | null;
  dragging: string | null; target: DropAt | null; drag: ReturnType<typeof createListDrag>;
  onGripKey: (e: KeyboardEvent, id: string) => void; onTap: (id: string) => void; whyWords: (why: string, truck: string) => string;
}
function TruckPart(p: TruckProps) {
  const l = lang.value;
  const tr = p.truck;
  const ids = p.lists.flatMap((x) => [...x.live, ...x.jobs]);
  const jobs = ids.map(p.rowOf).filter((j): j is Job => !!j);
  const done = p.rows.filter((j) => j.truck_id === tr && j.status === 'done').length;
  const sum = p.cur?.trucks.filter((x) => x.id === tr) ?? [];
  const stopOf = (id: string) => p.cur?.byId.get(id) ?? null;
  // the head: from the server's answer, else (this truck unchanged) the stored plan, else « calcul… »
  const etas = jobs.map((j) => (p.cur ? stopOf(j.id)?.eta ?? null : j.eta_min)).filter((x): x is number => x != null);
  const last = jobs[jobs.length - 1];
  const finish = sum.length ? Math.max(...sum.map((x) => x.finish ?? 0)) : last && last.eta_min != null ? last.eta_min + last.duration_min : null;
  const drive = sum.length ? sum.reduce((k, x) => k + (x.driveMin ?? 0), 0) : jobs.reduce((k, j) => k + Math.max(0, (j.travel_min ?? 0)), 0);
  const unmeasured = sum.length ? sum.reduce((k, x) => k + x.unmeasured, 0) : roadsOn.value ? jobs.filter((j) => etaUnsure(j)).length : 0;
  const over = p.judge ? sum.find((x) => x.overMin > 0) : undefined;
  // (« calcul… » only while the preview is waited for: refused or no answer, nothing is being worked out: review F8)
  const head = !jobs.length ? '' : p.changedHere && !p.cur ? (p.asking === 'asking' ? t('reorg.asking') : '')
    : etas.length && finish != null
      ? t(unmeasured ? 'reorg.truckHeadUnmeasured' : 'reorg.truckHead', { n: jobs.length, from: clock(Math.min(...etas), l), to: clock(finish, l), drive: duration(drive, l) })
      : '';
  const refusedHere = p.dragging && p.target?.truck === tr && p.target.refused ? p.target.refused : null;
  const warnHere = refusedHere || p.refTruck === tr;
  return (
    <section class="dayord-truck" data-dayord-truck={tr} data-testid={`dayorder-truck-${tr}`} aria-labelledby={`dayord-h-${tr}`}>
      <div class={`dayord-head${warnHere ? ' is-refused' : ''}`} data-dayord-end data-truck={tr} data-testid={`dayorder-head-${tr}`}>
        <div class="grow">
          <h3 id={`dayord-h-${tr}`}>{truckLabel(tr)}</h3>
          {head && <p data-testid={`dayorder-headline-${tr}`}>{head}</p>}
          {over && over.finish != null && <p class="dayord-warn" data-testid={`dayorder-over-${tr}`}>{t('reorg.truckOver', { end: clock(over.finish, l), hours: over.hoursEnd != null ? clock(over.hoursEnd, l) : '' })}</p>}
          {refusedHere && <p class="dayord-warn" data-testid={`dayorder-refused-${tr}`}>{p.whyWords(refusedHere, tr)}</p>}
        </div>
        <Help text={t('reorg.help')} />
      </div>
      {done > 0 && <p class="dayord-done">{t('reorg.done', { n: done })}</p>}
      {p.lists.map((x) => {
        const b = blockOfKey(x.block);
        const showBlock = p.blocksMode && (x.jobs.length > 0 || x.live.length > 0 || worksOn(tr, p.draft.day, x.block));
        if (p.blocksMode && !showBlock) return null;
        const line = p.dragging && p.target && !p.target.refused && p.target.truck === tr && p.target.block === x.block ? Math.min(p.target.index, x.jobs.length) : null;
        return (
          <div key={x.block} class="dayord-list" data-block={x.block}>
            {p.blocksMode && <p class="dayord-block">{`${t(`common.blocks.${x.block}`)}, ${clockRange(b.start, b.end, l)}`}</p>}
            {x.live.map((id) => {
              const j = p.rowOf(id);
              if (!j) return null;
              return (
                <div key={id} class="dayord-live" data-dayord-live data-truck={tr} data-block={x.block} data-testid={`dayorder-live-${j.number}`}>
                  <span aria-hidden="true">•</span>
                  <span>{t(j.status === 'on_site' ? 'reorg.onSite' : 'reorg.enRoute', { name: jobName(j) })}</span>
                </div>
              );
            })}
            {x.jobs.map((id, i) => {
              const j = p.rowOf(id);
              if (!j) return null;
              return (
                <Fragment key={id}>
                  {line === i && <div class="dayord-line" aria-hidden="true" data-testid="dayorder-line" />}
                  <StopRow job={j} pos={x.live.length + i + 1} index={i} truck={tr} block={x.block} s={verdictOf(p.cur ? p.cur.byId.get(id) ?? null : null, p.judge)}
                    known={!!p.cur || !p.changedHere} asking={p.asking === 'asking' && p.changedHere} draft={p.draft}
                    isThis={p.at.job === id} picked={p.picked === id} warn={p.refJobs.includes(id)} dragging={p.dragging === id}
                    isNew={p.draft.news.includes(id)} drag={p.drag} onGripKey={p.onGripKey} onTap={p.onTap} />
                </Fragment>
              );
            })}
            {line != null && line >= x.jobs.length && <div class="dayord-line" aria-hidden="true" data-testid="dayorder-line" />}
            {(p.dragging || !x.jobs.length) && (
              <div class={`dayord-end${line != null && line >= x.jobs.length ? ' is-over' : ''}`} data-dayord-end data-truck={tr} data-block={x.block} data-testid={`dayorder-end-${tr}${p.blocksMode ? `-${x.block}` : ''}`}>
                {t('reorg.dropHere')}
              </div>
            )}
          </div>
        );
      })}
      {unmeasured > 0 && <p class="dayord-note" data-testid={`dayorder-unmeasured-${tr}`}>{t('reorg.unmeasuredTruck')}</p>}
      {p.blocksMode && <p class="dayord-note">{t('reorg.otherBlock')}</p>}
    </section>
  );
}

/* ---------- one stop ---------- */

interface RowProps {
  job: Job; pos: number; index: number; truck: string; block: string; s: DayStop | null;
  /** the times shown are the server's (an answer for this draft, or this truck unchanged: its stored plan) */
  known: boolean; asking: boolean; draft: Draft; isThis: boolean; picked: boolean; warn: boolean; dragging: boolean; isNew: boolean;
  drag: ReturnType<typeof createListDrag>; onGripKey: (e: KeyboardEvent, id: string) => void; onTap: (id: string) => void;
}
function StopRow(p: RowProps) {
  const l = lang.value;
  const j = p.job;
  const s = p.s;
  const waiting = moveWaiting(j.id);
  const name = jobName(j);
  // the arrival: the server's (« heure : trajets pas encore mesurés » when a trip is not), « calcul… » while asked
  const eta = waiting ? t('reorg.waiting')
    : s ? (s.measured === false ? t('jobs.order.etaUnmeasured') : s.eta != null ? t('reorg.at', { time: clock(s.eta, l) }) : '')
      : p.known ? (etaUnsure(j) ? t('jobs.order.etaUnmeasured') : j.eta_min != null ? t('reorg.at', { time: clock(j.eta_min, l) }) : '')
        : p.asking ? t('reorg.asking') : '';
  const words = hoursWords(j, s, l);
  return (
    <div class={`dayord-row${p.isThis ? ' is-this' : ''}${p.warn || words.warn ? ' is-warn' : ''}${p.dragging ? ' is-dragging' : ''}${p.picked ? ' is-picked' : ''}`}
      data-dayord-row data-id={j.id} data-truck={p.truck} data-block={p.block} data-index={p.index} data-testid={`dayorder-row-${j.number}`}>
      {waiting ? <span class="dayord-nogrip" aria-hidden="true">≡</span> : (
        <button type="button" class="dayord-grip" aria-label={t('reorg.grip', { name })} aria-describedby="dayord-keys" aria-pressed={p.picked}
          data-dayord-grip={j.id} data-testid={`dayorder-grip-${j.number}`} {...p.drag.grip(j.id)}
          onKeyDown={(e) => p.onGripKey(e, j.id)} onClick={(e) => { if (e.detail > 0) p.onTap(j.id); }}>≡</button>
      )}
      <button type="button" class="dayord-main" data-testid={`dayorder-main-${j.number}`} {...(waiting ? {} : p.drag.main(j.id))}
        onClick={() => { if (!waiting) p.onTap(j.id); }}>
        <span class="dayord-l1">
          <span class="dayord-n">{p.pos}</span>
          <span class="dayord-name">{name}</span>
          {p.isNew && <Pill tone="ok">{t('reorg.newStop')}</Pill>}
          {words.pill && <Pill tone="warn" data-testid={`dayorder-pill-${j.number}`}>{words.pill}</Pill>}
        </span>
        <span class="dayord-l2">
          <b data-testid={`dayorder-eta-${j.number}`}>{eta}</b>
          {words.hours && <span data-testid={`dayorder-hours-${j.number}`}>{words.hours}</span>}
        </span>
        {words.notes.map((x, i) => (
          <span key={i} class={`dayord-l3 is-${x.tone}`} data-testid={`dayorder-note-${j.number}`}>
            {x.tone === 'warn' ? <AlertTriangle aria-hidden="true" /> : x.tone === 'ok' ? <CircleCheck aria-hidden="true" /> : null}
            <span>{x.text}</span>
          </span>
        ))}
      </button>
    </div>
  );
}

/** nothing changed: the server's times only, no verdict of a save that cannot happen (no new window, late, pin lost) */
function verdictOf(s: DayStop | null, judge: boolean): DayStop | null {
  return !s || judge ? s : { ...s, newWin: null, winBack: false, flexFixed: false, lateMin: 0, earlyMin: 0, pinLost: null, pinMoved: false, over: false };
}
/** the hours part of a row, and what it says beyond (§2.5) */
function hoursWords(j: Job, s: DayStop | null, l: string): { hours: ComponentChildren; pill: string | null; notes: { tone: 'warn' | 'ok' | 'muted'; text: string }[]; warn: boolean } {
  const notes: { tone: 'warn' | 'ok' | 'muted'; text: string }[] = [];
  let pill: string | null = null;
  let hours: ComponentChildren = null;
  const range = (w: [number, number]) => ({ from: clock(w[0], l), to: clock(w[1], l) });
  if (j.block === 'day') {
    const win: [number, number] | null = s ? s.win : j.win_start != null && j.win_end != null ? [j.win_start, j.win_end] : null;
    if (s?.winBack && s.newWin && win) {
      notes.push({ tone: 'ok', text: t('reorg.winBack', { ...range(win), tfrom: clock(s.newWin[0], l), tto: clock(s.newWin[1], l) }) });
      hours = t('reorg.window', range(s.newWin));
    } else if (s?.newWin && win && !s.flexFixed) {
      pill = t('reorg.newWindow');
      hours = t('reorg.winNew', { ...range(win), nfrom: clock(s.newWin[0], l), nto: clock(s.newWin[1], l) });
      if (j.told_at && dayOf(new Date(j.told_at)) === today()) notes.push({ tone: 'warn', text: t('reorg.toldToday') });
    } else if (!win) {
      hours = s?.flexFixed && s.newWin ? t('reorg.flexNew', range(s.newWin))
        : s?.flexLater ? t('reorg.flexLater', { time: clock(lockMinute(), l) })
          : s && s.measured === false && lockDue(j.day) ? t('reorg.flexUnmeasured')
            : !s && j.win_flex !== false && !lockDue(j.day) ? t('reorg.flexLater', { time: clock(lockMinute(), l) })
              : t('common.blocks.day');
    } else {
      // planned ≠ told (days F1): what he was told after the planned window
      let told = '';
      if (j.told_at && j.told_day && j.told_day !== j.day) told = t('reorg.toldDay', { day: tinyDay(j.told_day, l) });
      else if (j.told_at && j.told_start != null && j.told_end != null && (j.told_start !== win[0] || j.told_end !== win[1])) told = t('reorg.told', range([j.told_start, j.told_end]));
      hours = told ? `${t('reorg.window', range(win))}, ${told}` : t('reorg.window', range(win));
    }
  }
  if (s && s.lateMin > 0) notes.push({ tone: 'warn', text: t('reorg.lateRow', { by: duration(s.lateMin, l) }) });
  if (s && s.earlyMin > 0) notes.push({ tone: 'warn', text: t('reorg.earlyRow', { by: duration(s.earlyMin, l) }) });
  if (s?.pinLost != null) notes.push({ tone: 'warn', text: s.pinMoved ? t('reorg.pinDropped', { time: clock(s.pinLost, l) }) : t('reorg.pinLost', { time: clock(s.pinLost, l), eta: s.eta != null ? clock(s.eta, l) : '' }) });
  else if ((s ? s.pin : j.arrive_at) != null) notes.push({ tone: 'muted', text: t('reorg.pinKept', { time: clock((s ? s.pin : j.arrive_at)!, l) }) });
  if (s?.over) notes.push({ tone: 'warn', text: t('reorg.autoOver', { name: jobFirstName(j) }) });
  return { hours, pill, notes, warn: notes.some((x) => x.tone === 'warn') };
}

/* ---------- the row's menu (a tap on the row: the way for one hand, and the fallback of the drag) ---------- */

function RowMenu(p: {
  id: string; draft: Draft; job: Job | undefined; trucks: string[]; book: boolean; ctx: DropCtx; whyWords: (why: string, truck: string) => string;
  onClose: () => void; onFirst: () => void; onMove: (delta: number) => void; onOn: (truck: string) => void; onBack: () => void;
}) {
  const pl = placeOf(p.draft, p.id);
  if (!p.job || !pl) return null;
  const list = listOf(p.draft, pl.truck, pl.block);
  const last = (list?.jobs.length ?? 1) - 1;
  const base = p.draft.base[p.id];
  const away = !!base && (base.truck !== pl.truck || base.index !== pl.index);
  const go = (fn: () => void) => () => { p.onClose(); whenHistorySettled(fn); };
  return (
    <Sheet open onClose={p.onClose} title={jobName(p.job)} data-testid="dayorder-menu">
      <div class="dayord-menu">
        <Button block icon={<ChevronsUp size={18} />} disabled={pl.index === 0} onClick={go(p.onFirst)} data-testid="dayorder-menu-first">{t('reorg.menuFirst')}</Button>
        <Button block icon={<ArrowUp size={18} />} disabled={pl.index === 0} onClick={go(() => p.onMove(-1))} data-testid="dayorder-menu-up">{t('reorg.menuUp')}</Button>
        <Button block icon={<ArrowDown size={18} />} disabled={pl.index >= last} onClick={go(() => p.onMove(1))} data-testid="dayorder-menu-down">{t('reorg.menuDown')}</Button>
        {p.book && p.trucks.filter((x) => x !== pl.truck).map((tr) => {
          const why = canDrop(p.draft, p.job!, tr, pl.block, p.ctx);
          const no = why && why !== 'kind' ? why : null;
          return (
            <Button key={tr} block icon={<TruckIcon size={18} />} disabled={!!no} onClick={go(() => p.onOn(tr))} data-testid={`dayorder-menu-on-${tr}`}>
              {t('reorg.menuOn', { truck: truckLabel(tr) })}{no && <small>{p.whyWords(no, tr)}</small>}
            </Button>
          );
        })}
        {away && <Button block icon={<Undo2 size={18} />} onClick={go(p.onBack)} data-testid="dayorder-menu-back">{t('reorg.menuBack')}</Button>}
      </div>
    </Sheet>
  );
}
