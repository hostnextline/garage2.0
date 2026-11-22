/* Pieces shared by the two forms of the week (the block table and the time grid): a truck's short name, the head of a
   day's column (with, for the owner and « Réserver », a small warn count of that day's customers who do not have their
   new hours yet: Part 28, REARRANGE.md §3.2; the button lives on the day), the legend of the trucks. */
import { TriangleAlert } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { longDay, parseDay, today as todayOf, type Day } from '../../lib/dates';
import { truck as truckRow, staffName, truckColor, truckLabel, activeTrucks, allJobs } from '../../data/select';
import { can } from '../../data/auth';
import { tellCtx, clientsDue } from '../../domain/jobs/told';
import { activeCount, laneShown } from './select';

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
  const n = activeCount(d);
  const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long' });
  // customers of that day who do not have their new hours yet (owner / « Réserver »; 0: nothing)
  const due = can('book') && d >= todayOf() ? clientsDue(d, allJobs.value, tellCtx()) : 0;
  const line = due ? t('tell.line', { n: due }) : '';
  return (
    <button type="button" class="agenda-dayhd-btn" onClick={() => p.onOpenDay(d)} aria-label={[t('agenda.week.openDay', { day: longDay(d, l) }), line].filter(Boolean).join('. ')} data-testid={`dayhd-${d}`}>
      <span class="agenda-dayhd-wd">{wd.format(parseDay(d))}</span>
      <span class="agenda-dayhd-num">{parseDay(d).getDate()}</span>
      <span class="agenda-dayhd-n">{d === todayOf() ? t('common.today') : t('agenda.week.jobs', { n })}</span>
      {due > 0 && <span class="pill pill-en_route" title={line} data-testid={`dayhd-told-${d}`}><TriangleAlert size={12} aria-hidden="true" />{due}</span>}
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
