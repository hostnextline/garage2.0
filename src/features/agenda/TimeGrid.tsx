/* The time grid of the agenda (« Plages d'arrivée », screens ≥ 760 px): rows of 15 minutes from the first hour of the
   garage to the last, a column per truck (the day) or per day (the week). A job is a block at its planned arrival, as
   tall as its work. An empty unit books that day at that time (click, or right-click « Réserver ici » / « Coller ici »);
   a booked job dragged to a unit is moved there (move.ts). The maths is in domain/moment/grid.ts.
   While a job is dragged only the ghost under the pointer redraws: the units and the blocks are memoised. */
import { useLayoutEffect, useRef } from 'preact/hooks';
import { memo } from 'preact/compat';
import type { RefObject } from 'preact';
import { t, lang } from '../../lib/i18n';
import { clock, nowMinute, today as todayOf, type BlockKey, type Day, type Range } from '../../lib/dates';
import { blocks, truckColor, windowOf } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../domain/rights';
import { UNIT, unitCount, unitMinutes, unitIndex, minuteAt, unitsAt, jobBox, jobMinute, overlapColumns, openingUnit } from '../../domain/moment/grid';
import { dropRefusal, winShort } from './layout';
import { moveFlow, moveToTime } from './move';
import { unitMenu, unitBookHref, placeWords } from './actions';
import { canDragJob, leftFor, type Drag, type Refusal } from './drag';
import { GridJob } from './GridJob';

/** what a unit belongs to: the whole day (windows) or a block (a day still booked by blocks), and whether it still books */
export interface Place { block: BlockKey; start: number; end: number; v: { started: boolean; open: boolean; room?: boolean } }
/** the place of a minute among a column's places (null: nothing books there) */
export function placeAt(places: readonly Place[], m: number): Place | null {
  return places.find((x) => m >= x.start && m < x.end) ?? null;
}

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

/* ---------- the units of a column (memoised on what they draw) ---------- */
interface UnitsProps { day: Day; span: Range; suffix: string; on: boolean[] | null; places: readonly Place[]; past: number; book: boolean; l: string }
const sameUnits = (a: UnitsProps, b: UnitsProps) =>
  a.day === b.day && a.span[0] === b.span[0] && a.span[1] === b.span[1] && a.suffix === b.suffix && a.on === b.on && a.past === b.past && a.book === b.book && a.l === b.l
  && a.places.length === b.places.length && a.places.every((x, i) => { const y = b.places[i]; return x.block === y.block && x.start === y.start && x.end === y.end && x.v.open === y.v.open && x.v.started === y.v.started && x.v.room === y.v.room; });
/** `past`: the units ending at or before this minute are over (-1: none) */
const Units = memo(function Units(p: UnitsProps) {
  const l = lang.value;
  const when = placeWords(p.day, 'day');
  return (
    <>
      {unitMinutes(p.span).map((m, i) => {
        const place = placeAt(p.places, m);
        const off = !!p.on && !p.on[i];
        const isPast = m + UNIT <= p.past;
        const free = !!place && p.book && place.v.open && !place.v.started && !off && !isPast;
        const cls = `agenda-unit${m % 60 === 0 ? ' is-hour' : m % 30 === 0 ? ' is-half' : ''}${off || !place ? ' is-off' : ''}${isPast ? ' is-past' : ''}`;
        const testid = `grid-unit-${p.day}-${m}${p.suffix}`;
        if (!free || !place) return <span key={m} class={cls} data-testid={testid} />;
        return (
          <a key={m} class={`${cls} is-free`} href={unitBookHref(p.day, place.block, m)} tabIndex={-1} data-time={clock(m, l)} aria-label={t('agenda.grid.unit', { when, time: clock(m, l) })}
            onContextMenu={(e) => unitMenu(e as MouseEvent, p.day, place.block, place.v, m)} data-testid={testid} />
        );
      })}
    </>
  );
}, sameUnits);

/** the place a dragged job would take under the pointer: the only piece that follows the pointer */
function Ghost(p: { drag: Drag; colKey: string; span: Range; places: readonly Place[]; compact: boolean }) {
  const over = p.drag.over.value;
  const job = p.drag.job;
  if (!over || over.key !== p.colKey || !job) return null;
  const box = jobBox(p.span, over.minute, job.duration_min);
  const place = placeAt(p.places, over.minute);
  const l = lang.value;
  return (
    <div class={`agenda-grid-ghost${over.ok ? '' : ' is-no'}`} style={{ top: `calc(var(--u) * ${unitIndex(p.span, over.minute)})`, height: `calc(var(--u) * ${box.height})` }} aria-hidden="true">
      <b>{clock(over.minute, l)}</b>
      {over.ok && place?.block === 'day' && !p.compact && <span>{winShort(windowOf(over.minute), l)}</span>}
    </div>
  );
}

/* ---------- a column: its units, its jobs, the place a dragged job would take ---------- */
export interface ColumnProps {
  day: Day; span: Range;
  /** the truck of the column (the day view); null: the app chooses (the week) */
  truckId: string | null;
  /** the units somebody works in (the others are greyed and book nothing); null: all of them */
  on: boolean[] | null;
  /** what the units belong to (a minute outside them: nothing books there) */
  places: readonly Place[];
  jobs: Job[];
  compact: boolean;
  drag: Drag;
  now?: boolean;
}
export function GridColumn(p: ColumnProps) {
  const { day, span, drag, places } = p;
  const n = unitCount(span);
  const todayDay = todayOf();
  // the minute before which units are over: the whole day once past, the minute now today
  const past = day < todayDay ? span[1] + UNIT : day === todayDay ? nowMinute() : -1;
  const key = `${day}|${p.truckId ?? ''}`;
  const refusalAt = (m: number): Refusal => {
    const j = drag.job;
    const place = placeAt(places, m);
    if (!j) return 'same';
    if (!place) return 'closed';
    const why = dropRefusal(j, { day, block: place.block }, place.v);
    return why || (m + UNIT <= past ? 'past' : null);
  };
  const minuteOf = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return minuteAt(span, e.clientY - r.top, r.height / n);
  };
  // the jobs as blocks; the ones that share some time sit side by side
  const placed = p.jobs.map((j) => ({ j, box: jobBox(span, jobMinute(j, blocks.value) ?? span[0], j.duration_min) }));
  const slots = overlapColumns(placed.map((x) => ({ id: x.j.id, start: x.box.top, end: x.box.top + x.box.height })));
  return (
    <div class={`agenda-grid-col${day === todayDay ? ' is-today' : ''}`} style={p.truckId ? { '--tc': truckColor(p.truckId) } : undefined}
      onDragOver={(e) => {
        if (!drag.job) return;
        const m = minuteOf(e as DragEvent);
        const why = refusalAt(m);
        const dt = (e as DragEvent).dataTransfer;
        if (!why) { e.preventDefault(); if (dt) dt.dropEffect = 'move'; } else if (dt) dt.dropEffect = 'none';
        const pl = placeAt(places, m);
        drag.hover({ key, minute: m, ok: !why }, why, !pl || pl.block === 'day');
      }}
      onDragLeave={(e) => { if (leftFor(e as DragEvent)) drag.leave(key); }}
      onDrop={(e) => {
        e.preventDefault();
        const m = minuteOf(e as DragEvent);
        const place = placeAt(places, m);
        if (refusalAt(m) || !place) { drag.end(); return; }
        const j = drag.take();
        if (!j) return;
        if (place.block === 'day') void moveToTime(j, day, p.truckId, m);
        else void moveFlow(j, { day, block: place.block });
      }}>
      <Units day={day} span={span} suffix={p.truckId ? `-${p.truckId}` : ''} on={p.on} places={places} past={past} book={may.book()} l={lang.value} />
      {placed.map((x) => (
        <GridJob key={x.j.id} job={x.j} box={x.box} slot={slots.get(x.j.id) || { col: 0, cols: 1 }} compact={p.compact}
          draggable={canDragJob(x.j)} dragging={drag.job?.id === x.j.id} onDragStart={drag.start} onDragEnd={drag.end} />
      ))}
      <Ghost drag={drag} colKey={key} span={span} places={places} compact={p.compact} />
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

/** the worked units of each column, kept as the same array while they do not change: the memoised units then skip
    their redraw (they are recomputed from the hours on each redraw of the grid, which is cheap) */
export function useStableUnits(): (key: string, on: boolean[]) => boolean[] {
  const cache = useRef(new Map<string, boolean[]>()).current;
  return (key, on) => {
    const cur = cache.get(key);
    if (cur && cur.length === on.length && cur.every((x, i) => x === on[i])) return cur;
    cache.set(key, on);
    return on;
  };
}
