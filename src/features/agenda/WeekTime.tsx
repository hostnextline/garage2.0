/* The week on a computer when it has days booked by arrival windows: ONE time grid for the whole week. The hours on
   the left (15 minutes per unit), a column per day; each job is a block at its planned arrival, as tall as its work,
   in its truck's colour; two trucks' jobs at the same hour sit side by side. A day still booked by blocks (the days
   before the switch) is drawn in the same grid: its jobs at their arrival, else at the first hour of their block.
   Above the grid, for each day: how full each truck is, the jobs « À placer », « Coller », « Réserver ». */
import { useComputed } from '@preact/signals';
import { Plus, TriangleAlert, ClipboardPaste } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { today as todayOf, type Day, type Range } from '../../lib/dates';
import { blocks, daySpan, windowsOn, truckColor, truckLabel, truckRanges, activeTrucks } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../domain/rights';
import { unitCount, workedUnits, jobMinute } from '../../domain/moment/grid';
import { freeWords } from '../../domain/moment/words';
import { dropRefusal, weekTitle } from './layout';
import { laneShown, type DayPlan } from './select';
import { moveFlow } from './move';
import { blockMenu, blockPress, mayPaste, placeWords } from './actions';
import { pasteHref, bookHref } from './copy';
import { canDragJob, leftFor, useGridDrag, type Drag } from './drag';
import { GridColumn, TimeAxis, useOpeningScroll, useStableUnits, type Place } from './TimeGrid';
import { Meter } from './Meter';
import { Chip } from './Chip';
import { DayHdButton, TruckLegend, shortTruck } from './WeekParts';

/** above a day's column: how full each truck is, the jobs with no place on the grid, « Coller » and « Réserver ».
    A day of windows takes a job let go here: the sheet of the windows still possible opens. */
function DayTop(p: { plan: DayPlan; loose: Job[]; unplaced: Job[]; drag: Drag }) {
  const l = lang.value;
  const { plan, drag } = p;
  const day = plan.day;
  const v = plan.window ? plan.views[0] : null;
  const key = `top|${day}`;
  const closed = plan.views.every((x) => x.closed);
  const job = drag.job;
  const refusal = v && job ? dropRefusal(job, { day, block: 'day' }, v) : 'same';
  const target = !!v && !!job && refusal === null;
  const over = useComputed(() => drag.over.value?.key === key).value;
  const when = placeWords(day, 'day');
  const canBook = !!v && may.book() && v.open && v.room;
  const cls = ['agenda-grid-top', day === todayOf() && 'is-today', closed && 'is-closed', job && v && (target ? 'is-target' : 'is-refused'), over && target && 'is-over'].filter(Boolean).join(' ');
  const chip = (j: Job, unplaced: boolean) => <Chip key={j.id} job={j} unplaced={unplaced} draggable={canDragJob(j)} dragging={job?.id === j.id} onDragStart={drag.start} onDragEnd={drag.end} />;
  return (
    <div class={cls} data-testid={`cell-${day}-${v ? 'day' : 'blocks'}`}
      onContextMenu={v ? (e) => blockMenu(e as MouseEvent, day, 'day', v) : undefined} {...(v ? blockPress(day, 'day', v) : {})}
      onDragOver={(e) => {
        if (!job || !v) return;
        const dt = (e as DragEvent).dataTransfer;
        if (target) { e.preventDefault(); if (dt) dt.dropEffect = 'move'; } else if (dt) dt.dropEffect = 'none';
        drag.hover({ key, minute: 0, ok: target }, refusal, true);
      }}
      onDragLeave={(e) => { if (leftFor(e as DragEvent)) drag.leave(key); }}
      onDrop={(e) => {
        e.preventDefault();
        if (!target) { drag.end(); return; }
        const j = drag.take();
        if (j) void moveFlow(j, { day, block: 'day' });
      }}>
      {closed && <span class="agenda-cell-closed">{t('agenda.block.closed')}</span>}
      {v && !v.started && v.lanes.filter((x) => x.cap > 0).map((x) => (
        <div class="agenda-cell-lane" key={x.truck.id} style={{ '--tc': truckColor(x.truck.id) }} title={`${truckLabel(x.truck.id)} : ${freeWords(x.used, x.cap, l, false, true)}`}>
          <Meter used={x.used} cap={x.cap} label={truckLabel(x.truck.id)} small />
          <span class={`agenda-cell-free${x.cap - x.used <= 0 ? ' is-full' : ''}`}><b>{shortTruck(x.truck.id)}</b> {freeWords(x.used, x.cap, l, true, true)}</span>
        </div>
      ))}
      {p.unplaced.length + p.loose.length > 0 && (
        <div class="agenda-chips">
          {p.unplaced.map((j) => chip(j, true))}
          {p.loose.map((j) => chip(j, false))}
        </div>
      )}
      {p.unplaced.length > 0 && <span class="agenda-cell-warn"><TriangleAlert size={14} aria-hidden="true" />{t('agenda.lane.unplaced')}</span>}
      {target && over && <span class="agenda-grid-topdrop">{t(job?.day === day ? 'agenda.week.dropSame' : 'agenda.week.drop')}</span>}
      {v && (mayPaste(v) || canBook) && (
        // kept in place (only hidden) while a job is dragged: the grid under the pointer must not move
        <span class="agenda-grid-topacts" style={job ? { visibility: 'hidden' } : undefined}>
          {mayPaste(v) && (
            <a class="agenda-cell-paste" href={pasteHref(day, 'day')} aria-label={t('agenda.copy.pasteIn', { when })} title={t('agenda.copy.pasteIn', { when })} data-testid={`cell-paste-${day}-day`}>
              <ClipboardPaste size={16} aria-hidden="true" /><span>{t('agenda.copy.pasteShort')}</span>
            </a>
          )}
          {canBook && (
            <a class="agenda-grid-topbook" href={bookHref(day, 'day')} aria-label={t('agenda.week.book', { when })} title={t('agenda.week.book', { when })} data-testid={`cell-book-${day}-day`}><Plus size={16} aria-hidden="true" /></a>
          )}
        </span>
      )}
    </div>
  );
}

/** what a day's column of the week holds: its places, the jobs drawn on it, the ones with no time, the unplaced */
function columnOf(plan: DayPlan, minute: (j: Job) => number | null) {
  const jobs = plan.views.flatMap((v) => v.lanes.flatMap((x) => x.jobs));
  const places: Place[] = plan.window
    ? [{ block: 'day', start: -Infinity, end: Infinity, v: plan.views[0] }]
    : plan.views.map((v) => ({ block: v.key, start: v.start, end: v.end, v }));
  return { plan, places, placed: jobs.filter((j) => minute(j) != null), loose: jobs.filter((j) => minute(j) == null), unplaced: plan.views.flatMap((v) => v.unplaced) };
}

export function WeekTimeGrid(p: { day: Day; plans: DayPlan[]; onOpenDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const span: Range = daySpan.value;
  const drag = useGridDrag();
  const stable = useStableUnits();
  const shown = activeTrucks.value.filter((tr) => laneShown(tr.id));
  const minute = (j: Job) => jobMinute(j, blocks.value);
  const days = p.plans.map((x) => x.day);
  const cols = p.plans.map((plan) => {
    // greyed: the units nobody works in
    const on = shown.map((tr) => workedUnits(truckRanges(tr.id, plan.day), span)).reduce<boolean[]>((a, w) => a.map((x, k) => x || w[k]), Array(unitCount(span)).fill(false));
    return { ...columnOf(plan, minute), on: stable(plan.day, on) };
  });
  const first = cols.flatMap((c) => c.placed.map(minute)).reduce<number | null>((a, m) => (m == null ? a : a == null ? m : Math.min(a, m)), null);
  const scroll = useOpeningScroll(span, days[0], first, days.includes(todayDay));
  return (
    <div class="agenda-weekwrap glass" data-tour="agenda-week" data-testid="agenda-week">
      <TruckLegend />
      <div class={`agenda-grid is-week${drag.job ? ' is-dragging' : ''}`} style={{ '--cols': days.length, '--units': unitCount(span) }} role="group" aria-label={`${weekTitle(p.day, l)}. ${t('agenda.grid.week')}`} data-testid="grid-week">
        <div class="agenda-grid-head">
          <span class="agenda-grid-corner" />
          {days.map((d) => (
            <div key={d} class={`agenda-dayhd${d === todayDay ? ' is-today' : ''}${d < todayDay ? ' is-past' : ''}`} aria-current={d === todayDay ? 'date' : undefined}>
              <DayHdButton day={d} onOpenDay={p.onOpenDay} />
            </div>
          ))}
        </div>
        <div class="agenda-grid-head is-tops">
          <span class="agenda-grid-corner"><span class="sr-only">{t('agenda.grid.trucks')}</span></span>
          {cols.map((c) => <DayTop key={c.plan.day} plan={c.plan} loose={c.loose} unplaced={c.unplaced} drag={drag} />)}
        </div>
        <div class="agenda-grid-scroll" ref={scroll}>
          <div class="agenda-grid-body">
            <TimeAxis span={span} />
            <div class="agenda-grid-cols">
              {cols.map((c) => <GridColumn key={c.plan.day} day={c.plan.day} span={span} truckId={null} on={c.on} places={c.places} jobs={c.placed} compact drag={drag} now={c.plan.day === todayDay} />)}
            </div>
          </div>
        </div>
      </div>
      {may.book() && <p class="faint small agenda-hint">{t('agenda.grid.hintWeek')} {t(windowsOn.value ? 'agenda.copy.hintDay' : 'agenda.copy.hint')}</p>}
    </div>
  );
}
