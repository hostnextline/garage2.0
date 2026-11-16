/* A job as a block of the time grid: at its planned arrival, as tall as its work, in its truck's colour; the stop number,
   the person, the arrival, the window told (« Flexible », « Hors plage »), the work when there is room.
   Dragged to move it; right-click / long press: its menu. Memoised: a pointer moving over the grid redraws none. */
import { memo } from 'preact/compat';
import { TriangleAlert, CloudUpload } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clock, duration } from '../../lib/dates';
import { truckColor, customer as customerRow } from '../../data/select';
import type { Job } from '../../data/types';
import type { Box, Slot } from '../../domain/moment/grid';
import { jobStatusWord } from '../../ui';
import { jobPerson } from '../../domain/jobs/words';
import { winInfo, winShort, winTiny } from './layout';
import { firstWork } from './work';
import { jobMenu, jobPress } from './actions';
import { movesWaiting } from './move';

interface GridJobProps { job: Job; box: Box; slot: Slot; compact: boolean; draggable: boolean; dragging: boolean; onDragStart: (j: Job, e: DragEvent) => void; onDragEnd: () => void }
/** the same block: the same row of the job (rows are replaced, never changed in place), place, size and state */
const sameBlock = (a: GridJobProps, b: GridJobProps) =>
  a.job === b.job && a.box.top === b.box.top && a.box.height === b.box.height && a.slot.col === b.slot.col && a.slot.cols === b.slot.cols
  && a.compact === b.compact && a.draggable === b.draggable && a.dragging === b.dragging && a.onDragStart === b.onDragStart && a.onDragEnd === b.onDragEnd;

export const GridJob = memo(function GridJob(p: GridJobProps) {
  const j = p.job;
  const l = lang.value;
  const name = jobPerson(j) || customerRow(j.customer_id)?.phone || `#${j.number}`;
  const work = firstWork(j.id) || j.problem || '';
  const w = winInfo(j);
  const booked = j.status === 'booked';
  const win = w ? (w.win ? winShort(w.win, l) : w.flex ? t('agenda.win.flex') : '') : t(`common.blocks.${j.block}`);
  // the week's narrow blocks: the window as short as it gets (« 14 h–18 h », “2–6 p.m.”)
  const winSmall = w?.win ? winTiny(w.win, l) : win;
  const eta = j.eta_min != null ? clock(j.eta_min, l) : '';
  const late = !!w?.late;
  // a move of it still kept on the phone (agenda-14): said on the block
  const waits = movesWaiting.value.has(j.id);
  const label = [waits ? t('agenda.move.waiting') : '', j.stop_order ? t('agenda.lane.stop', { n: j.stop_order }) : '', name, eta ? t('agenda.grid.eta', { time: eta }) : '', win, late ? t('common.window.late') : '', work, jobStatusWord(j.status, l), duration(j.duration_min, l)].filter(Boolean).join(', ');
  // how many lines of text fit (a line is 13 px, a unit 16 px, 4 px go to the edges)
  const lines = Math.max(2, Math.floor((p.box.height * 16 - 4) / 13));
  const { col, cols } = p.slot;
  return (
    <a href={`#/job/${j.id}`} class={`agenda-gjob st-${j.status}${late ? ' is-late' : ''}${p.compact ? ' is-compact' : ''}${p.draggable ? ' can-drag' : ''}${p.dragging ? ' is-dragging' : ''}${waits ? ' is-waiting' : ''}`}
      style={{ '--tc': truckColor(j.truck_id), top: `calc(var(--u) * ${p.box.top})`, height: `calc(var(--u) * ${p.box.height})`, left: `${(col / cols) * 100}%`, width: `${100 / cols}%` }}
      draggable={p.draggable} aria-label={label} title={label}
      onDragStart={(e) => p.onDragStart(j, e as DragEvent)} onDragEnd={p.onDragEnd} onContextMenu={(e) => jobMenu(e as MouseEvent, j)} {...jobPress(j)} data-testid={`grid-job-${j.id}`}>
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
        {waits && <span class="agenda-wait" data-testid={`grid-wait-${j.id}`}><CloudUpload size={11} aria-hidden="true" />{t('agenda.move.waiting')}</span>}
        {lines >= 3 && work && <span class="agenda-gjob-sub">{work}</span>}
      </span>
    </a>
  );
}, sameBlock);
