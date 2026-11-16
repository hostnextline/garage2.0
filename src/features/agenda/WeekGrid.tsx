/* The week on a computer: days in columns (Sunday → Saturday), blocks in rows. Each cell shows how full each truck
   is and its jobs as small tickets; a booked job dragged onto another cell is moved (after a question).
   « Plages d'arrivée »: a week that has a day booked by arrival windows is drawn as ONE time grid, 15 minutes per unit
   (WeekTime.tsx); this table only ever holds days of blocks. */
import { useComputed } from '@preact/signals';
import { Plus, TriangleAlert, ClipboardPaste } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clockRange, today as todayOf, type BlockKey, type Day } from '../../lib/dates';
import { blocks, windowsOn, truckColor, truckLabel } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../domain/rights';
import { href } from '../../platform/router';
import { freeWords } from '../../domain/moment/words';
import { dropRefusal, weekTitle } from './layout';
import type { BlockView, DayPlan } from './select';
import { moveFlow } from './move';
import { blockMenu, mayPaste, blockPress, placeWords } from './actions';
import { pasteHref } from './copy';
import { canDragJob, leftFor, useGridDrag, type Drag } from './drag';
import { Meter } from './Meter';
import { Chip } from './Chip';
import { WeekTimeGrid } from './WeekTime';
import { DayHdButton, TruckLegend, shortTruck } from './WeekParts';

function Cell(p: { day: Day; v: BlockView; isToday: boolean; drag: Drag }) {
  const l = lang.value;
  const { v, day, drag } = p;
  const k = `${day}|${v.key}`;
  const job = drag.job;
  const refusal = job ? dropRefusal(job, { day, block: v.key }, { started: v.started, open: v.open }) : 'same';
  const target = !!job && refusal === null;
  // only this cell redraws when the pointer comes in or goes out
  const isOver = useComputed(() => drag.over.value?.key === k).value;
  const canBook = may.book() && v.open && v.room;
  const placed = v.lanes.flatMap((x) => x.jobs);
  const when = placeWords(day, v.key);
  const cls = ['agenda-cell', p.isToday && 'is-today', v.started && 'is-started', v.closed && 'is-closed', job && (target ? 'is-target' : 'is-refused'), isOver && target && 'is-over'].filter(Boolean).join(' ');
  const chip = (j: Job, unplaced: boolean) => <Chip key={j.id} job={j} unplaced={unplaced} draggable={canDragJob(j)} dragging={job?.id === j.id} onDragStart={drag.start} onDragEnd={drag.end} />;
  return (
    <td class={cls} data-testid={`cell-${day}-${v.key}`} onContextMenu={(e) => blockMenu(e as MouseEvent, day, v.key, v)} {...blockPress(day, v.key, v)}
      onDragOver={(e) => {
        if (!job) return;
        if (target) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } else if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        drag.hover({ key: k, minute: 0, ok: target }, refusal, false);
      }}
      onDragLeave={(e) => { if (leftFor(e as DragEvent)) drag.leave(k); }}
      onDrop={(e) => {
        e.preventDefault();
        if (!target) { drag.end(); return; }
        const j = drag.take();
        if (j) void moveFlow(j, { day, block: v.key });
      }}>
      <div class="agenda-cell-in">
        {v.closed && <span class="agenda-cell-closed">{t('agenda.block.closed')}</span>}
        {!v.started && v.lanes.filter((x) => x.cap > 0).map((x) => (
          <div class="agenda-cell-lane" key={x.truck.id} style={{ '--tc': truckColor(x.truck.id) }} title={`${truckLabel(x.truck.id)} : ${freeWords(x.used, x.cap, l, false)}`}>
            <Meter used={x.used} cap={x.cap} label={truckLabel(x.truck.id)} small />
            <span class={`agenda-cell-free${x.cap - x.used <= 0 ? ' is-full' : ''}`}><b>{shortTruck(x.truck.id)}</b> {freeWords(x.used, x.cap, l, true)}</span>
          </div>
        ))}
        {placed.length + v.unplaced.length > 0 && (
          <div class="agenda-chips">
            {placed.map((j) => chip(j, false))}
            {v.unplaced.map((j) => chip(j, true))}
          </div>
        )}
        {v.unplaced.length > 0 && <span class="agenda-cell-warn"><TriangleAlert size={14} aria-hidden="true" />{t('agenda.lane.unplaced')}</span>}
        {target && isOver && <span class="agenda-cell-drop">{t('agenda.week.drop')}</span>}
        {mayPaste(v) && !job && (
          <a class="agenda-cell-paste" href={pasteHref(day, v.key)} aria-label={t('agenda.copy.pasteIn', { when })}
            title={t('agenda.copy.pasteIn', { when })} data-testid={`cell-paste-${day}-${v.key}`}><ClipboardPaste size={16} aria-hidden="true" /><span>{t('agenda.copy.pasteShort')}</span></a>
        )}
        {canBook && !job && (
          <a class="agenda-cell-book" href={href('/book', { day, block: v.key })} aria-label={t('agenda.week.book', { when })}
            title={t('agenda.week.book', { when })} data-testid={`cell-book-${day}-${v.key}`}><Plus size={18} /></a>
        )}
      </div>
    </td>
  );
}

/** `plans`: the week's days, each drawn once per redraw of the agenda (they hold every lane of the week) */
export function WeekGrid(p: { day: Day; plans: DayPlan[]; onOpenDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const drag = useGridDrag();
  const { plans } = p;
  // a day booked by arrival windows in the week: the whole week as one time grid (15 minutes per unit)
  if (plans.some((x) => x.window)) return <WeekTimeGrid day={p.day} plans={plans} onOpenDay={p.onOpenDay} />;
  return (
    <div class="agenda-weekwrap glass" data-tour="agenda-week" data-testid="agenda-week">
      <TruckLegend />
      <table class={`agenda-week${drag.job ? ' is-dragging' : ''}`}>
        <caption class="sr-only">{weekTitle(p.day, l)}</caption>
        <thead>
          <tr>
            <th scope="col" class="agenda-corner"><span class="sr-only">{t('booking.block.title')}</span></th>
            {plans.map(({ day: d }) => {
              const isToday = d === todayDay;
              return (
                <th scope="col" key={d} class={`agenda-dayhd${isToday ? ' is-today' : ''}${d < todayDay ? ' is-past' : ''}`} aria-current={isToday ? 'date' : undefined}>
                  <DayHdButton day={d} onOpenDay={p.onOpenDay} />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {blocks.value.map((b: { key: BlockKey; start: number; end: number }, bi) => (
            <tr key={b.key}>
              <th scope="row" class="agenda-blockhd">
                <span class="agenda-blockhd-name">{t(`common.blocks.${b.key}`)}</span>
                <span class="agenda-blockhd-hours">{clockRange(b.start, b.end, l)}</span>
              </th>
              {plans.map((plan) => <Cell key={plan.day} day={plan.day} v={plan.views[bi]} isToday={plan.day === todayDay} drag={drag} />)}
            </tr>
          ))}
        </tbody>
      </table>
      {may.book() && <p class="faint small agenda-hint">{t(windowsOn.value ? 'agenda.week.dragHintDay' : 'agenda.week.dragHint')} {t(windowsOn.value ? 'agenda.copy.hintDay' : 'agenda.copy.hint')}</p>}
    </div>
  );
}
