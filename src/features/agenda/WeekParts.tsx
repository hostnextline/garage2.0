/* Pieces shared by the two forms of the week (the block table and the time grid): a truck's short name, the head of a
   day's column, the legend of the trucks. */
import { TriangleAlert } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { longDay, parseDay, today as todayOf, type Day } from '../../lib/dates';
import { truck as truckRow, staffName, truckColor, truckLabel, activeTrucks } from '../../data/select';
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
