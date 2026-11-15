/* The week on a computer: days in columns (Sunday → Saturday), blocks in rows. Each cell shows how full each truck
   is and its jobs as small tickets; a booked job dragged onto another cell is moved (after a question).
   « Plages d'arrivée »: a week that has a day booked by arrival windows is drawn as ONE time grid, 15 minutes per unit
   (WeekTime.tsx); a week of blocks only keeps the block rows below. */
import { useRef, useState } from 'preact/hooks';
import { Plus, TriangleAlert, ClipboardPaste } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clockRange, today as todayOf, type BlockKey, type Day } from '../../lib/dates';
import { blocks, windowsOn, truckColor, truckLabel } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../app/routes';
import { href } from '../../app/router';
import { toast } from '../../ui';
import { dropRefusal, freeWords, weekOfDay, weekTitle, type DropRefusal } from './layout';
import { dayPlan, type BlockView } from './select';
import { Meter } from './DayView';
import { moveFlow } from './move';
import { blockMenu, mayPaste, blockPress, placeWords } from './actions';
import { pasteHref } from './copy';
import { Chip } from './Chip';
import { WeekTimeGrid, DayHdButton, TruckLegend, shortTruck } from './WeekTime';

const cellKey = (day: Day, block: BlockKey) => `${day}|${block}`;
function Cell(p: { day: Day; v: BlockView; extra?: BlockView[]; rowSpan?: number; isToday: boolean; drag: Job | null; over: string | null; setOver: (k: string | null) => void; setRefused: (r: DropRefusal, whole: boolean) => void; startDrag: (j: Job, e: DragEvent) => void; endDrag: () => void; drop: (to: { day: Day; block: BlockKey }) => void }) {
  const l = lang.value;
  const { v, day } = p;
  const k = cellKey(day, v.key);
  const closed = !v.open && !v.started;
  const refusal = p.drag ? dropRefusal(p.drag, { day, block: v.key }, { started: v.started, open: v.open }) : 'same';
  const target = !!p.drag && refusal === null;
  const canBook = may.book() && v.open && v.room;
  const canDrag = (j: Job) => may.book() && j.status === 'booked';
  const whole = v.key === 'day';
  // a day of windows that still holds jobs of a block (right after the switch): shown after the day's own
  const placed = [...v.lanes.flatMap((x) => x.jobs), ...(p.extra || []).flatMap((x) => x.lanes.flatMap((y) => y.jobs))];
  const unplaced = [...v.unplaced, ...(p.extra || []).flatMap((x) => x.unplaced)];
  const when = placeWords(day, v.key);
  const cls = ['agenda-cell', whole && 'is-day', p.isToday && 'is-today', v.started && 'is-started', closed && 'is-closed', p.drag && (target ? 'is-target' : 'is-refused'), p.over === k && target && 'is-over'].filter(Boolean).join(' ');
  return (
    <td class={cls} rowSpan={p.rowSpan} data-testid={`cell-${day}-${v.key}`} onContextMenu={(e) => blockMenu(e as MouseEvent, day, v.key, v)} {...blockPress(day, v.key, v)}
      onDragOver={(e) => { if (!p.drag) return; if (target) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } else if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; p.setRefused(refusal === 'same' ? null : refusal, whole); if (p.over !== k) p.setOver(k); }}
      onDragLeave={(e) => { if (p.over === k && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) p.setOver(null); }}
      onDrop={(e) => { e.preventDefault(); if (target) p.drop({ day, block: v.key }); else p.endDrag(); }}>
      <div class="agenda-cell-in">
        {closed && <span class="agenda-cell-closed">{t('agenda.block.closed')}</span>}
        {!v.started && v.lanes.filter((x) => x.cap > 0).map((x) => (
          <div class="agenda-cell-lane" key={x.truck.id} style={{ '--tc': truckColor(x.truck.id) }} title={`${truckLabel(x.truck.id)} : ${freeWords(x.used, x.cap, l, false, whole)}`}>
            <Meter used={x.used} cap={x.cap} label={truckLabel(x.truck.id)} small />
            <span class={`agenda-cell-free${x.cap - x.used <= 0 ? ' is-full' : ''}`}><b>{shortTruck(x.truck.id)}</b> {freeWords(x.used, x.cap, l, true, whole)}</span>
          </div>
        ))}
        {placed.length + unplaced.length > 0 && (
          <div class="agenda-chips">
            {placed.map((j) => <Chip key={j.id} job={j} draggable={canDrag(j)} dragging={p.drag?.id === j.id} onDragStart={p.startDrag} onDragEnd={p.endDrag} />)}
            {unplaced.map((j) => <Chip key={j.id} job={j} unplaced draggable={canDrag(j)} dragging={p.drag?.id === j.id} onDragStart={p.startDrag} onDragEnd={p.endDrag} />)}
          </div>
        )}
        {unplaced.length > 0 && <span class="agenda-cell-warn"><TriangleAlert size={14} aria-hidden="true" />{t('agenda.lane.unplaced')}</span>}
        {target && p.over === k && <span class="agenda-cell-drop">{t(whole && p.drag?.day === day ? 'agenda.week.dropSame' : 'agenda.week.drop')}</span>}
        {mayPaste(v) && !p.drag && (
          <a class="agenda-cell-paste" href={pasteHref(day, v.key)} aria-label={t('agenda.copy.pasteIn', { when })}
            title={t('agenda.copy.pasteIn', { when })} data-testid={`cell-paste-${day}-${v.key}`}><ClipboardPaste size={16} aria-hidden="true" /><span>{t('agenda.copy.pasteShort')}</span></a>
        )}
        {canBook && !p.drag && (
          <a class="agenda-cell-book" href={href('/book', { day, block: v.key })} aria-label={t('agenda.week.book', { when })}
            title={t('agenda.week.book', { when })} data-testid={`cell-book-${day}-${v.key}`}><Plus size={18} /></a>
        )}
      </div>
    </td>
  );
}

export function WeekGrid(p: { day: Day; onOpenDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const days = weekOfDay(p.day);
  const bl = blocks.value;
  const [drag, setDrag] = useState<Job | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // where the job was let go: a block that can't take it says why (instead of nothing happening)
  const refusedAt = useRef<DropRefusal>(null);
  const refusedWhole = useRef(false);   // the place that refused was a whole day (« Plages d'arrivée »)
  const startDrag = (j: Job, e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', j.id);
    // let the browser take the picture of the ticket before the grid changes
    setTimeout(() => setDrag(j), 0);
  };
  const endDrag = () => {
    const why = refusedAt.current;
    refusedAt.current = null;
    setDrag(null); setOver(null);
    if (why === 'started') toast(t(refusedWhole.current ? 'agenda.move.startedDay' : 'agenda.move.started'));
    else if (why === 'closed') toast(t(refusedWhole.current ? 'agenda.move.closedDay' : 'agenda.move.closed'));
    else if (why === 'not_booked') toast(t('agenda.move.notBooked'));
  };
  const drop = (to: { day: Day; block: BlockKey }) => {
    const j = drag;
    refusedAt.current = null;
    endDrag();
    if (j) void moveFlow(j, to);
  };
  const plans = days.map((d) => dayPlan(d, todayDay));
  // a day booked by arrival windows in the week: the whole week as one time grid (15 minutes per unit)
  if (plans.some((x) => x.window)) return <WeekTimeGrid day={p.day} days={days} plans={plans} onOpenDay={p.onOpenDay} />;
  const rows = bl;
  return (
    <div class="agenda-weekwrap glass" data-tour="agenda-week" data-testid="agenda-week">
      <TruckLegend />
      <table class={`agenda-week${drag ? ' is-dragging' : ''}`}>
        <caption class="sr-only">{weekTitle(p.day, l)}</caption>
        <thead>
          <tr>
            <th scope="col" class="agenda-corner"><span class="sr-only">{t('booking.block.title')}</span></th>
            {days.map((d) => {
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
          {rows.map((b, bi) => (
            <tr key={b.key}>
              <th scope="row" class="agenda-blockhd">
                <span class="agenda-blockhd-name">{t(`common.blocks.${b.key}`)}</span>
                <span class="agenda-blockhd-hours">{clockRange(b.start, b.end, l)}</span>
              </th>
              {days.map((d, di) => {
                const plan = plans[di];
                if (plan.window && bi > 0) return null;   // its one cell started in the first row
                const v = plan.window ? plan.views[0] : plan.views[bi];
                return <Cell key={d} day={d} v={v} extra={plan.window ? plan.views.slice(1) : undefined} rowSpan={plan.window && rows.length > 1 ? rows.length : undefined} isToday={d === todayDay} drag={drag} over={over} setOver={setOver} setRefused={(r, whole) => { refusedAt.current = r; refusedWhole.current = whole; }} startDrag={startDrag} endDrag={endDrag} drop={drop} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {may.book() && <p class="faint small agenda-hint">{t(windowsOn.value ? 'agenda.week.dragHintDay' : 'agenda.week.dragHint')} {t(windowsOn.value ? 'agenda.copy.hintDay' : 'agenda.copy.hint')}</p>}
    </div>
  );
}
