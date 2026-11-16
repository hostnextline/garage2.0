/* The time grid of the agenda (« Plages d'arrivée », screens ≥ 760 px): rows of 15 minutes from the first hour of the
   garage to the last, a column per truck (the day) or per day (the week). A job is a block at its planned arrival, as
   tall as its work. An empty unit books that day at that time (click, or right-click « Réserver ici » / « Coller ici »);
   a booked job dragged to a unit is moved there (move.ts). The maths is in grid.ts. */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { TriangleAlert } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clock, duration, nowMinute, today as todayOf, type BlockKey, type Day, type Range } from '../../lib/dates';
import { blocks, truckColor, itemsOf, customer as customerRow, windowOf } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../domain/rights';
import { jobStatusWord, toast } from '../../ui';
import { dropRefusal, winInfo, winShort, winTiny, type DropRefusal } from './layout';
import { UNIT, unitCount, unitMinutes, unitIndex, minuteAt, unitsAt, jobBox, jobMinute, overlapColumns, openingUnit, type Box, type Slot } from '../../domain/moment/grid';
import { moveFlow, moveToTime } from './move';
import { jobPerson } from '../../domain/jobs/words';
import { jobMenu, jobPress, unitMenu, unitBookHref, placeWords } from './actions';

/** what a unit belongs to: the whole day (windows) or a block (a day still booked by blocks), and whether it still books */
export interface Place { block: BlockKey; v: { started: boolean; open: boolean; room?: boolean } }
export type Refusal = DropRefusal | 'past';

/* ---------- a job being dragged (shared by every column of a grid) ---------- */
export interface Drag {
  job: Job | null;
  over: { key: string; minute: number; ok: boolean } | null;
  setOver: (o: Drag['over']) => void;
  /** why the place under the pointer refuses the job (said when it is let go there) */
  refuse: (why: Refusal, whole: boolean) => void;
  start: (j: Job, e: DragEvent) => void;
  end: () => void;
  /** the job was let go on a good place: forgets the drag, gives the job */
  take: () => Job | null;
}
export function useGridDrag(): Drag {
  const [job, setJob] = useState<Job | null>(null);
  const [over, setOver] = useState<Drag['over']>(null);
  const refused = useRef<{ why: Refusal; whole: boolean } | null>(null);
  const clear = () => { refused.current = null; setJob(null); setOver(null); };
  return {
    job, over, setOver,
    refuse: (why, whole) => { refused.current = why && why !== 'same' ? { why, whole } : null; },
    start: (j, e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', j.id);
      // let the browser take the picture of the block before the grid changes
      setTimeout(() => setJob(j), 0);
    },
    end: () => {
      const r = refused.current;
      clear();
      if (!r) return;
      if (r.why === 'started') toast(t(r.whole ? 'agenda.move.startedDay' : 'agenda.move.started'));
      else if (r.why === 'closed') toast(t(r.whole ? 'agenda.move.closedDay' : 'agenda.move.closed'));
      else if (r.why === 'not_booked') toast(t('agenda.move.notBooked'));
      else if (r.why === 'past') toast(t('agenda.move.pastTime'));
    },
    take: () => { const j = job; clear(); return j; }
  };
}
export const canDragJob = (j: Job) => may.book() && j.status === 'booked';

/* ---------- the hours on the left ---------- */
export function TimeAxis(p: { span: Range }) {
  const l = lang.value;
  const hours = unitMinutes(p.span).filter((m) => m % 60 === 0);
  return (
    <div class="agenda-grid-axis" aria-hidden="true">
      {hours.map((m) => <span key={m} class="agenda-grid-hour" style={{ top: `calc(var(--u) * ${unitIndex(p.span, m)})` }}>{clock(m, l)}</span>)}
      {p.span[1] % 60 === 0 && <span class="agenda-grid-hour" style={{ top: `calc(var(--u) * ${unitCount(p.span)})` }}>{clock(p.span[1], l)}</span>}
    </div>
  );
}

/** the line of « now » (today only, inside the day's hours) */
export function NowLine(p: { span: Range; day: Day }) {
  const now = nowMinute();
  const at = p.day === todayOf() ? unitsAt(p.span, now) : null;
  if (at == null) return null;
  const words = t('agenda.grid.now', { time: clock(now, lang.value) });
  return <div class="agenda-grid-now" style={{ top: `calc(var(--u) * ${at})` }} role="img" aria-label={words} title={words} data-testid="grid-now" />;
}

/* ---------- a job as a block ---------- */
function GridJob(p: { job: Job; box: Box; slot: Slot; compact: boolean; drag: Drag }) {
  const j = p.job;
  const l = lang.value;
  const name = jobPerson(j) || customerRow(j.customer_id)?.phone || `#${j.number}`;
  const first = itemsOf(j.id).find((i) => i.status !== 'removed' && i.status !== 'declined');
  const work = first?.description || j.problem || '';
  const w = winInfo(j);
  const booked = j.status === 'booked';
  const win = w ? (w.win ? winShort(w.win, l) : w.flex ? t('agenda.win.flex') : '') : t(`common.blocks.${j.block}`);
  // the week's narrow blocks: the window as short as it gets (« 14 h–18 h », “2–6 p.m.”)
  const winSmall = w?.win ? winTiny(w.win, l) : win;
  const eta = j.eta_min != null ? clock(j.eta_min, l) : '';
  const late = !!w?.late;
  const label = [j.stop_order ? t('agenda.lane.stop', { n: j.stop_order }) : '', name, eta ? t('agenda.grid.eta', { time: eta }) : '', win, late ? t('common.window.late') : '', work, jobStatusWord(j.status, l), duration(j.duration_min, l)].filter(Boolean).join(', ');
  // how many lines of text fit (a line is 13 px, a unit 16 px, 4 px go to the edges)
  const lines = Math.max(2, Math.floor((p.box.height * 16 - 4) / 13));
  const draggable = canDragJob(j);
  const { col, cols } = p.slot;
  return (
    <a href={`#/job/${j.id}`} class={`agenda-gjob st-${j.status}${late ? ' is-late' : ''}${p.compact ? ' is-compact' : ''}${draggable ? ' can-drag' : ''}${p.drag.job?.id === j.id ? ' is-dragging' : ''}`}
      style={{ '--tc': truckColor(j.truck_id), top: `calc(var(--u) * ${p.box.top})`, height: `calc(var(--u) * ${p.box.height})`, left: `${(col / cols) * 100}%`, width: `${100 / cols}%` }}
      draggable={draggable} aria-label={label} title={label}
      onDragStart={(e) => p.drag.start(j, e as DragEvent)} onDragEnd={p.drag.end} onContextMenu={(e) => jobMenu(e as MouseEvent, j)} {...jobPress(j)} data-testid={`grid-job-${j.id}`}>
      <span class="agenda-gjob-in" aria-hidden="true">
        <span class="agenda-gjob-top">
          <b class="agenda-gjob-stop">{j.stop_order ?? '–'}</b>
          <span class="agenda-gjob-name">{name}</span>
          {!p.compact && eta && <span class="agenda-gjob-eta">{eta}</span>}
        </span>
        <span class={`agenda-gjob-win${late ? ' is-late' : ''}${w?.flex ? ' is-flex' : ''}`} data-testid={`grid-win-${j.id}`}>
          {late && <TriangleAlert size={11} aria-hidden="true" />}
          {booked ? (p.compact ? winSmall : late ? `${win} · ${t('common.window.late')}` : win) : jobStatusWord(j.status, l)}
        </span>
        {lines >= 3 && work && <span class="agenda-gjob-sub">{work}</span>}
      </span>
    </a>
  );
}

/* ---------- a column: its units, its jobs, the place a dragged job would take ---------- */
export interface ColumnProps {
  day: Day; span: Range;
  /** the truck of the column (the day view); null: the app chooses (the week) */
  truckId: string | null;
  /** the units somebody works in (the others are greyed and book nothing); null: all of them */
  on: boolean[] | null;
  /** what a unit belongs to (null: nothing books there) */
  placeOf: (minute: number) => Place | null;
  jobs: Job[];
  compact: boolean;
  drag: Drag;
  now?: boolean;
}
export function GridColumn(p: ColumnProps) {
  const l = lang.value;
  const { day, span, drag } = p;
  const n = unitCount(span);
  const todayDay = todayOf();
  const now = nowMinute();
  const key = `${day}|${p.truckId ?? ''}`;
  const isPast = (m: number) => day < todayDay || (day === todayDay && m + UNIT <= now);
  const refusalAt = (m: number): Refusal => {
    const j = drag.job;
    const place = p.placeOf(m);
    if (!j) return 'same';
    if (!place) return 'closed';
    const why = dropRefusal(j, { day, block: place.block }, place.v);
    return why || (isPast(m) ? 'past' : null);
  };
  const minuteOf = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return minuteAt(span, e.clientY - r.top, r.height / n);
  };
  // the jobs as blocks; the ones that share some time sit side by side
  const placed = p.jobs.map((j) => ({ j, box: jobBox(span, jobMinute(j, blocks.value) ?? span[0], j.duration_min) }));
  const slots = overlapColumns(placed.map((x) => ({ id: x.j.id, start: x.box.top, end: x.box.top + x.box.height })));
  const over = drag.over && drag.over.key === key ? drag.over : null;
  const ghost = over && drag.job ? jobBox(span, over.minute, drag.job.duration_min) : null;
  const ghostPlace = over ? p.placeOf(over.minute) : null;
  const when = placeWords(day, 'day');
  const suffix = p.truckId ? `-${p.truckId}` : '';
  return (
    <div class={`agenda-grid-col${day === todayDay ? ' is-today' : ''}`} style={p.truckId ? { '--tc': truckColor(p.truckId) } : undefined}
      onDragOver={(e) => {
        if (!drag.job) return;
        const m = minuteOf(e as DragEvent);
        const why = refusalAt(m);
        const dt = (e as DragEvent).dataTransfer;
        if (!why) { e.preventDefault(); if (dt) dt.dropEffect = 'move'; } else if (dt) dt.dropEffect = 'none';
        const pl = p.placeOf(m);
        drag.refuse(why, !pl || pl.block === 'day');
        if (!over || over.minute !== m || over.ok !== !why) drag.setOver({ key, minute: m, ok: !why });
      }}
      onDragLeave={(e) => { if (over && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) drag.setOver(null); }}
      onDrop={(e) => {
        e.preventDefault();
        const m = minuteOf(e as DragEvent);
        const place = p.placeOf(m);
        if (refusalAt(m) || !place) { drag.end(); return; }
        const j = drag.take();
        if (!j) return;
        if (place.block === 'day') void moveToTime(j, day, p.truckId, m);
        else void moveFlow(j, { day, block: place.block });
      }}>
      {unitMinutes(span).map((m, i) => {
        const place = p.placeOf(m);
        const off = !!p.on && !p.on[i];
        const free = !!place && may.book() && place.v.open && !place.v.started && !off && !isPast(m);
        const cls = `agenda-unit${m % 60 === 0 ? ' is-hour' : m % 30 === 0 ? ' is-half' : ''}${off || !place ? ' is-off' : ''}${isPast(m) ? ' is-past' : ''}`;
        const testid = `grid-unit-${day}-${m}${suffix}`;
        if (!free || !place) return <span key={m} class={cls} data-testid={testid} />;
        return (
          <a key={m} class={`${cls} is-free`} href={unitBookHref(day, place.block, m)} tabIndex={-1} data-time={clock(m, l)} aria-label={t('agenda.grid.unit', { when, time: clock(m, l) })}
            onContextMenu={(e) => unitMenu(e as MouseEvent, day, place.block, place.v, m)} data-testid={testid} />
        );
      })}
      {placed.map((x) => <GridJob key={x.j.id} job={x.j} box={x.box} slot={slots.get(x.j.id) || { col: 0, cols: 1 }} compact={p.compact} drag={drag} />)}
      {ghost && over && (
        <div class={`agenda-grid-ghost${over.ok ? '' : ' is-no'}`} style={{ top: `calc(var(--u) * ${unitIndex(span, over.minute)})`, height: `calc(var(--u) * ${ghost.height})` }} aria-hidden="true">
          <b>{clock(over.minute, l)}</b>
          {over.ok && ghostPlace?.block === 'day' && !p.compact && <span>{winShort(windowOf(over.minute), l)}</span>}
        </div>
      )}
      {p.now && <NowLine span={span} day={day} />}
    </div>
  );
}

/** the scrolling part of a grid: opens an hour before « now » (today) or before the first job */
export function useOpeningScroll(span: Range, day: Day, first: number | null, showsToday: boolean): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const col = el?.querySelector<HTMLElement>('.agenda-grid-col');
    if (!el || !col) return;
    const unit = col.offsetHeight / unitCount(span);
    el.scrollTop = openingUnit(span, showsToday ? nowMinute() : null, first) * unit;
  }, [day]);
  return ref;
}
