/* The week on a computer when it has days booked by arrival windows: ONE time grid for the whole week. The hours on
   the left (15 minutes per unit), a column per day; each job is a block at its planned arrival, as tall as its work,
   in its truck's colour; two trucks' jobs at the same hour sit side by side. A day still booked by blocks (the days
   before the switch) is drawn in the same grid: its jobs at their arrival, else at the first hour of their block.
   Above the grid, for each day: how full each truck is, the jobs « À placer », « Coller », « Réserver ». */
import { Plus, TriangleAlert, ClipboardPaste } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { longDay, parseDay, today as todayOf, type Day, type Range } from '../../lib/dates';
import { blocks, daySpan, windowsOn, truckColor, truckLabel, truckRanges, truck as truckRow, staffName, activeTrucks } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../domain/rights';
import { dropRefusal, weekTitle } from './layout';
import { freeWords } from '../../domain/moment/words';
import { dayJobs, isOff, laneShown, type DayPlan } from './select';
import { Meter } from './DayView';
import { Chip } from './Chip';
import { moveFlow } from './move';
import { blockMenu, blockPress, mayPaste, placeWords } from './actions';
import { pasteHref, bookHref } from './copy';
import { unitCount, workedUnits, jobMinute } from '../../domain/moment/grid';
import { GridColumn, TimeAxis, useGridDrag, useOpeningScroll, canDragJob, type Drag, type Place } from './TimeGrid';

/** a short name for a truck in a small cell: its driver (« Saleh »), or the first word of its name */
export function shortTruck(id: string): string {
  const tr = truckRow(id);
  if (!tr) return '';
  return staffName(tr.driver_id) || tr.name.split(/\s+/)[0];
}

/** the head of a day's column: the weekday, the date, how many jobs; opens that day */
export function DayHdButton(p: { day: Day; onOpenDay: (d: Day) => void }) {
  const l = lang.value;
  const d = p.day;
  const n = dayJobs(d).filter((j) => !isOff(j)).length;
  const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long' });
  return (
    <button type="button" class="agenda-dayhd-btn" onClick={() => p.onOpenDay(d)} aria-label={t('agenda.week.openDay', { day: longDay(d, l) })} data-testid={`dayhd-${d}`}>
      <span class="agenda-dayhd-wd">{wd.format(parseDay(d))}</span>
      <span class="agenda-dayhd-num">{parseDay(d).getDate()}</span>
      <span class="agenda-dayhd-n">{d === todayOf() ? t('common.today') : t('agenda.week.jobs', { n })}</span>
    </button>
  );
}
export function TruckLegend() {
  const shown = activeTrucks.value.filter((tr) => laneShown(tr.id));
  if (!shown.length) return null;
  return (
    <ul class="agenda-legend" aria-label={t('hours.trucks')}>
      {shown.map((tr) => <li key={tr.id} style={{ '--tc': truckColor(tr.id) }}><span class="agenda-dot" aria-hidden="true" />{truckLabel(tr.id)}</li>)}
      <li class="agenda-legend-unplaced"><TriangleAlert size={14} aria-hidden="true" />{t('agenda.lane.unplaced')}</li>
    </ul>
  );
}

/** above a day's column: how full each truck is, the jobs with no place on the grid, « Coller » and « Réserver ».
    A day of windows takes a job let go here: the sheet of the windows still possible opens. */
function DayTop(p: { day: Day; plan: DayPlan; loose: Job[]; unplaced: Job[]; drag: Drag }) {
  const l = lang.value;
  const { day, plan, drag } = p;
  const v = plan.window ? plan.views[0] : null;
  const key = `top|${day}`;
  const closed = plan.views.every((x) => !x.open && !x.started);
  const refusal = v && drag.job ? dropRefusal(drag.job, { day, block: 'day' }, v) : 'same';
  const target = !!v && !!drag.job && refusal === null;
  const over = drag.over?.key === key;
  const when = placeWords(day, 'day');
  const canBook = !!v && may.book() && v.open && v.room;
  const cls = ['agenda-grid-top', day === todayOf() && 'is-today', closed && 'is-closed', drag.job && v && (target ? 'is-target' : 'is-refused'), over && target && 'is-over'].filter(Boolean).join(' ');
  return (
    <div class={cls} data-testid={`cell-${day}-${v ? 'day' : 'blocks'}`}
      onContextMenu={v ? (e) => blockMenu(e as MouseEvent, day, 'day', v) : undefined} {...(v ? blockPress(day, 'day', v) : {})}
      onDragOver={(e) => {
        if (!drag.job || !v) return;
        const dt = (e as DragEvent).dataTransfer;
        if (target) { e.preventDefault(); if (dt) dt.dropEffect = 'move'; } else if (dt) dt.dropEffect = 'none';
        drag.refuse(refusal, true);
        if (!over) drag.setOver({ key, minute: 0, ok: target });
      }}
      onDragLeave={(e) => { if (over && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) drag.setOver(null); }}
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
          {p.unplaced.map((j) => <Chip key={j.id} job={j} unplaced draggable={canDragJob(j)} dragging={drag.job?.id === j.id} onDragStart={drag.start} onDragEnd={drag.end} />)}
          {p.loose.map((j) => <Chip key={j.id} job={j} draggable={canDragJob(j)} dragging={drag.job?.id === j.id} onDragStart={drag.start} onDragEnd={drag.end} />)}
        </div>
      )}
      {p.unplaced.length > 0 && <span class="agenda-cell-warn"><TriangleAlert size={14} aria-hidden="true" />{t('agenda.lane.unplaced')}</span>}
      {target && over && <span class="agenda-grid-topdrop">{t(drag.job?.day === day ? 'agenda.week.dropSame' : 'agenda.week.drop')}</span>}
      {v && (mayPaste(v) || canBook) && (
        // kept in place (only hidden) while a job is dragged: the grid under the pointer must not move
        <span class="agenda-grid-topacts" style={drag.job ? { visibility: 'hidden' } : undefined}>
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

export function WeekTimeGrid(p: { day: Day; days: Day[]; plans: DayPlan[]; onOpenDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const span: Range = daySpan.value;
  const drag = useGridDrag();
  const shown = activeTrucks.value.filter((tr) => laneShown(tr.id));
  const minute = (j: Job) => jobMinute(j, blocks.value);
  const cols = p.days.map((d, i) => {
    const plan = p.plans[i];
    const jobs = plan.views.flatMap((v) => v.lanes.flatMap((x) => x.jobs));
    const whole = plan.window ? plan.views[0] : null;
    const placeOf = (m: number): Place | null => {
      if (whole) return { block: 'day', v: whole };
      const b = plan.views.find((v) => m >= v.start && m < v.end);
      return b ? { block: b.key, v: b } : null;
    };
    // greyed: the units nobody works in
    const on = shown.map((tr) => workedUnits(truckRanges(tr.id, d), span)).reduce<boolean[]>((a, w) => a.map((x, k) => x || w[k]), Array(unitCount(span)).fill(false));
    return { day: d, plan, placeOf, on, placed: jobs.filter((j) => minute(j) != null), loose: jobs.filter((j) => minute(j) == null), unplaced: plan.views.flatMap((v) => v.unplaced) };
  });
  const first = cols.flatMap((c) => c.placed.map(minute)).reduce<number | null>((a, m) => (m == null ? a : a == null ? m : Math.min(a, m)), null);
  const scroll = useOpeningScroll(span, p.days[0], first, p.days.includes(todayDay));
  return (
    <div class="agenda-weekwrap glass" data-tour="agenda-week" data-testid="agenda-week">
      <TruckLegend />
      <div class={`agenda-grid is-week${drag.job ? ' is-dragging' : ''}`} style={{ '--cols': p.days.length, '--units': unitCount(span) }} role="group" aria-label={`${weekTitle(p.day, l)}. ${t('agenda.grid.week')}`} data-testid="grid-week">
        <div class="agenda-grid-head">
          <span class="agenda-grid-corner" />
          {p.days.map((d) => (
            <div key={d} class={`agenda-dayhd${d === todayDay ? ' is-today' : ''}${d < todayDay ? ' is-past' : ''}`} aria-current={d === todayDay ? 'date' : undefined}>
              <DayHdButton day={d} onOpenDay={p.onOpenDay} />
            </div>
          ))}
        </div>
        <div class="agenda-grid-head is-tops">
          <span class="agenda-grid-corner"><span class="sr-only">{t('agenda.grid.trucks')}</span></span>
          {cols.map((c) => <DayTop key={c.day} day={c.day} plan={c.plan} loose={c.loose} unplaced={c.unplaced} drag={drag} />)}
        </div>
        <div class="agenda-grid-scroll" ref={scroll}>
          <div class="agenda-grid-body">
            <TimeAxis span={span} />
            <div class="agenda-grid-cols">
              {cols.map((c) => <GridColumn key={c.day} day={c.day} span={span} truckId={null} on={c.on} placeOf={c.placeOf} jobs={c.placed} compact drag={drag} now={c.day === todayDay} />)}
            </div>
          </div>
        </div>
      </div>
      {may.book() && <p class="faint small agenda-hint">{t('agenda.grid.hintWeek')} {t(windowsOn.value ? 'agenda.copy.hintDay' : 'agenda.copy.hint')}</p>}
    </div>
  );
}
