/* A job as a small ticket of the week (computer): the stop number on the stub, the person and the work; a job booked by
   arrival window says its window, « Flexible », « Hors plage ». Dragged to move it; right-click / long press: its menu. */
import { TriangleAlert } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { truckColor, itemsOf, customer as customerRow } from '../../data/select';
import type { Job } from '../../data/types';
import { jobStatusWord } from '../../ui';
import { winInfo, winShort } from './layout';
import { isOff } from './select';
import { etaWord } from '../jobs/select';
import { jobPerson } from '../../domain/jobs/words';
import { jobMenu, jobPress } from './actions';

/** a job as a small ticket: the stop number on the stub, the person and the work */
export function Chip(p: { job: Job; unplaced?: boolean; draggable: boolean; dragging: boolean; onDragStart: (j: Job, e: DragEvent) => void; onDragEnd: () => void }) {
  const j = p.job;
  const l = lang.value;
  const name = jobPerson(j) || customerRow(j.customer_id)?.phone || `#${j.number}`;
  const first = itemsOf(j.id).find((i) => i.status !== 'removed' && i.status !== 'declined');
  const work = j.status !== 'booked' ? jobStatusWord(j.status, l) : first?.description || j.problem || '';
  const stub = p.unplaced ? '?' : j.stop_order ?? '–';
  // « Plages d'arrivée »: the window told to the customer, « Flexible », « Hors plage »
  const w = isOff(j) ? null : winInfo(j);
  const winWords = w ? [w.win ? winShort(w.win, l) : w.flex ? t('agenda.win.flex') : '', w.win && j.status === 'booked' ? etaWord(j.eta_min, l) : '', w.late ? t('common.window.late') : ''].filter(Boolean) : [];
  const label = [p.unplaced ? t('agenda.lane.unplaced') : j.stop_order ? t('agenda.lane.stop', { n: j.stop_order }) : '', name, work, ...winWords, jobStatusWord(j.status, l), duration(j.duration_min, l)].filter(Boolean).join(', ');
  return (
    <a href={`#/job/${j.id}`} class={`agenda-chip st-${j.status}${p.unplaced ? ' is-unplaced' : ''}${p.dragging ? ' is-dragging' : ''}${p.draggable ? ' can-drag' : ''}`}
      style={{ '--tc': p.unplaced ? 'var(--warn)' : truckColor(j.truck_id) }} draggable={p.draggable} aria-label={label} title={label}
      onDragStart={(e) => p.onDragStart(j, e as DragEvent)} onDragEnd={p.onDragEnd} onContextMenu={(e) => jobMenu(e as MouseEvent, j)} {...jobPress(j)} data-testid={`chip-${j.id}`}>
      <span class="agenda-chip-stub" aria-hidden="true">{stub}</span>
      <span class="agenda-chip-body" aria-hidden="true">
        <span class="agenda-chip-name">{name}</span>
        {work && <span class="agenda-chip-sub">{work}</span>}
        {w && (w.win || w.flex) && (
          <span class={`agenda-chip-win${w.late ? ' is-late' : ''}${w.flex ? ' is-flex' : ''}`} data-testid={`chip-win-${j.id}`}>
            {w.late && <TriangleAlert size={12} aria-hidden="true" />}{w.win ? winShort(w.win, l) : t('agenda.win.flex')}
          </span>
        )}
      </span>
    </a>
  );
}
