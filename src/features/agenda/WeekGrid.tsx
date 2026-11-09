/* The week on a computer: days in columns (Sunday → Saturday), blocks in rows. Each cell shows how full each truck
   is and its jobs as small tickets; a booked job dragged onto another cell is moved (after a question). */
import { useRef, useState } from 'preact/hooks';
import { Plus, TriangleAlert, ClipboardPaste } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clockRange, duration, longDay, parseDay, today as todayOf, type BlockKey, type Day } from '../../lib/dates';
import { blocks, truckColor, truckLabel, itemsOf, customer as customerRow, truck as truckRow, staffName, activeTrucks } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../app/routes';
import { href } from '../../app/router';
import { jobStatusWord, toast } from '../../ui';
import { blockPhrase } from '../booking/when';
import { dropRefusal, freeWords, weekOfDay, weekTitle, type DropRefusal } from './layout';
import { blockView, dayJobs, isOff, laneShown, type BlockView } from './select';
import { Meter } from './DayView';
import { moveFlow, jobPerson } from './move';
import { jobMenu, blockMenu, mayPaste } from './actions';
import { pasteHref } from './copy';

const cellKey = (day: Day, block: BlockKey) => `${day}|${block}`;
/** a short name for a truck in a small cell: its driver (« Saleh »), or the first word of its name */
function shortTruck(id: string): string {
  const tr = truckRow(id);
  if (!tr) return '';
  return staffName(tr.driver_id) || tr.name.split(/\s+/)[0];
}

/** a job as a small ticket: the stop number on the stub, the person and the work */
function Chip(p: { job: Job; unplaced?: boolean; draggable: boolean; dragging: boolean; onDragStart: (j: Job, e: DragEvent) => void; onDragEnd: () => void }) {
  const j = p.job;
  const l = lang.value;
  const name = jobPerson(j) || customerRow(j.customer_id)?.phone || `#${j.number}`;
  const first = itemsOf(j.id).find((i) => i.status !== 'removed' && i.status !== 'declined');
  const work = j.status !== 'booked' ? jobStatusWord(j.status, l) : first?.description || j.problem || '';
  const stub = p.unplaced ? '?' : j.stop_order ?? '–';
  const label = [p.unplaced ? t('agenda.lane.unplaced') : j.stop_order ? t('agenda.lane.stop', { n: j.stop_order }) : '', name, work, jobStatusWord(j.status, l), duration(j.duration_min, l)].filter(Boolean).join(', ');
  return (
    <a href={`#/job/${j.id}`} class={`agenda-chip st-${j.status}${p.unplaced ? ' is-unplaced' : ''}${p.dragging ? ' is-dragging' : ''}${p.draggable ? ' can-drag' : ''}`}
      style={{ '--tc': p.unplaced ? 'var(--warn)' : truckColor(j.truck_id) }} draggable={p.draggable} aria-label={label} title={label}
      onDragStart={(e) => p.onDragStart(j, e as DragEvent)} onDragEnd={p.onDragEnd} onContextMenu={(e) => jobMenu(e as MouseEvent, j)} data-testid={`chip-${j.id}`}>
      <span class="agenda-chip-stub" aria-hidden="true">{stub}</span>
      <span class="agenda-chip-body" aria-hidden="true">
        <span class="agenda-chip-name">{name}</span>
        {work && <span class="agenda-chip-sub">{work}</span>}
      </span>
    </a>
  );
}

function Cell(p: { day: Day; v: BlockView; isToday: boolean; drag: Job | null; over: string | null; setOver: (k: string | null) => void; setRefused: (r: DropRefusal) => void; startDrag: (j: Job, e: DragEvent) => void; endDrag: () => void; drop: (to: { day: Day; block: BlockKey }) => void }) {
  const l = lang.value;
  const { v, day } = p;
  const k = cellKey(day, v.key);
  const closed = !v.open && !v.started;
  const refusal = p.drag ? dropRefusal(p.drag, { day, block: v.key }, { started: v.started, open: v.open }) : 'same';
  const target = !!p.drag && refusal === null;
  const canBook = may.book() && v.open && v.room;
  const canDrag = (j: Job) => may.book() && j.status === 'booked';
  const cls = ['agenda-cell', p.isToday && 'is-today', v.started && 'is-started', closed && 'is-closed', p.drag && (target ? 'is-target' : 'is-refused'), p.over === k && target && 'is-over'].filter(Boolean).join(' ');
  return (
    <td class={cls} data-testid={`cell-${day}-${v.key}`} onContextMenu={(e) => blockMenu(e as MouseEvent, day, v.key, v)}
      onDragOver={(e) => { if (!p.drag) return; if (target) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } else if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; p.setRefused(refusal === 'same' ? null : refusal); if (p.over !== k) p.setOver(k); }}
      onDragLeave={(e) => { if (p.over === k && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) p.setOver(null); }}
      onDrop={(e) => { e.preventDefault(); if (target) p.drop({ day, block: v.key }); else p.endDrag(); }}>
      <div class="agenda-cell-in">
        {closed && <span class="agenda-cell-closed">{t('agenda.block.closed')}</span>}
        {!v.started && v.lanes.filter((x) => x.cap > 0).map((x) => (
          <div class="agenda-cell-lane" key={x.truck.id} style={{ '--tc': truckColor(x.truck.id) }} title={`${truckLabel(x.truck.id)} : ${freeWords(x.used, x.cap, l)}`}>
            <Meter used={x.used} cap={x.cap} label={truckLabel(x.truck.id)} small />
            <span class={`agenda-cell-free${x.cap - x.used <= 0 ? ' is-full' : ''}`}><b>{shortTruck(x.truck.id)}</b> {freeWords(x.used, x.cap, l, true)}</span>
          </div>
        ))}
        {v.lanes.flatMap((x) => x.jobs).length + v.unplaced.length > 0 && (
          <div class="agenda-chips">
            {v.lanes.flatMap((x) => x.jobs).map((j) => <Chip key={j.id} job={j} draggable={canDrag(j)} dragging={p.drag?.id === j.id} onDragStart={p.startDrag} onDragEnd={p.endDrag} />)}
            {v.unplaced.map((j) => <Chip key={j.id} job={j} unplaced draggable={canDrag(j)} dragging={p.drag?.id === j.id} onDragStart={p.startDrag} onDragEnd={p.endDrag} />)}
          </div>
        )}
        {v.unplaced.length > 0 && <span class="agenda-cell-warn"><TriangleAlert size={14} aria-hidden="true" />{t('agenda.lane.unplaced')}</span>}
        {target && p.over === k && <span class="agenda-cell-drop">{t('agenda.week.drop')}</span>}
        {mayPaste(v) && !p.drag && (
          <a class="agenda-cell-paste" href={pasteHref(day, v.key)} aria-label={t('agenda.copy.pasteIn', { when: blockPhrase(day, v.key, todayOf(), l) })}
            title={t('agenda.copy.pasteIn', { when: blockPhrase(day, v.key, todayOf(), l) })} data-testid={`cell-paste-${day}-${v.key}`}><ClipboardPaste size={16} aria-hidden="true" /><span>{t('agenda.copy.pasteShort')}</span></a>
        )}
        {canBook && !p.drag && (
          <a class="agenda-cell-book" href={href('/book', { day, block: v.key })} aria-label={t('agenda.week.book', { when: blockPhrase(day, v.key, todayOf(), l) })}
            title={t('agenda.week.book', { when: blockPhrase(day, v.key, todayOf(), l) })} data-testid={`cell-book-${day}-${v.key}`}><Plus size={18} /></a>
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
    if (why === 'started') toast(t('agenda.move.started'));
    else if (why === 'closed') toast(t('agenda.move.closed'));
    else if (why === 'not_booked') toast(t('agenda.move.notBooked'));
  };
  const drop = (to: { day: Day; block: BlockKey }) => {
    const j = drag;
    refusedAt.current = null;
    endDrag();
    if (j) void moveFlow(j, to);
  };
  const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long' });
  const views = days.map((d) => bl.map((b) => blockView(d, b, todayDay)));
  const shownTrucks = activeTrucks.value.filter((tr) => laneShown(tr.id));
  return (
    <div class="agenda-weekwrap glass" data-tour="agenda-week" data-testid="agenda-week">
      {shownTrucks.length > 0 && (
        <ul class="agenda-legend" aria-label={t('hours.trucks')}>
          {shownTrucks.map((tr) => <li key={tr.id} style={{ '--tc': truckColor(tr.id) }}><span class="agenda-dot" aria-hidden="true" />{truckLabel(tr.id)}</li>)}
          <li class="agenda-legend-unplaced"><TriangleAlert size={14} aria-hidden="true" />{t('agenda.lane.unplaced')}</li>
        </ul>
      )}
      <table class={`agenda-week${drag ? ' is-dragging' : ''}`}>
        <caption class="sr-only">{weekTitle(p.day, l)}</caption>
        <thead>
          <tr>
            <th scope="col" class="agenda-corner"><span class="sr-only">{t('booking.block.title')}</span></th>
            {days.map((d) => {
              const n = dayJobs(d).filter((j) => !isOff(j)).length;
              const isToday = d === todayDay;
              return (
                <th scope="col" key={d} class={`agenda-dayhd${isToday ? ' is-today' : ''}${d < todayDay ? ' is-past' : ''}`} aria-current={isToday ? 'date' : undefined}>
                  <button type="button" class="agenda-dayhd-btn" onClick={() => p.onOpenDay(d)} aria-label={t('agenda.week.openDay', { day: longDay(d, l) })} data-testid={`dayhd-${d}`}>
                    <span class="agenda-dayhd-wd">{wd.format(parseDay(d))}</span>
                    <span class="agenda-dayhd-num">{parseDay(d).getDate()}</span>
                    <span class="agenda-dayhd-n">{isToday ? t('common.today') : t('agenda.week.jobs', { n })}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {bl.map((b, bi) => (
            <tr key={b.key}>
              <th scope="row" class="agenda-blockhd">
                <span class="agenda-blockhd-name">{t(`common.blocks.${b.key}`)}</span>
                <span class="agenda-blockhd-hours">{clockRange(b.start, b.end, l)}</span>
              </th>
              {days.map((d, di) => (
                <Cell key={d} day={d} v={views[di][bi]} isToday={d === todayDay} drag={drag} over={over} setOver={setOver} setRefused={(r) => { refusedAt.current = r; }} startDrag={startDrag} endDrag={endDrag} drop={drop} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {may.book() && <p class="faint small agenda-hint">{t('agenda.week.dragHint')} {t('agenda.copy.hint')}</p>}
    </div>
  );
}
