/* How a line of « Rappels d’huile » is said: « Dû depuis 12 jours », « Rappeler le 20 juin », the car, the last oil change. */
import { t } from '../../lib/i18n';
import type { Day } from '../../lib/dates';
import { vehicle } from '../../data/select';
import type { Tone } from '../../ui';
import { dateShort } from '../../domain/moment/dayWords';
import { carName } from '../../domain/vehicles/words';
import type { OilRow } from '../../domain/oil/due';

/** « Dû depuis 12 jours », « Dû depuis 3 mois », « Dû le 4 déc. », « Rappeler le 20 juin » */
export function dueWords(r: OilRow): string {
  if (r.state === 'stopped') return t('oil.row.stopped');
  if (r.late >= 0) return r.late > 60 ? t('oil.row.lateMonths', { n: Math.floor(r.late / 30) }) : t('oil.row.lateDays', { n: r.late });
  return r.callOn > r.due ? t('oil.row.againOn', { day: dateShort(r.callOn) }) : t('oil.row.dueOn', { day: dateShort(r.callOn) });
}
export const tone = (r: OilRow): Tone => (r.state === 'stopped' ? 'muted' : r.late > 30 ? 'bad' : r.late >= 0 ? 'warn' : r.state === 'soon' ? 'booked' : 'muted');
export const carOf = (r: OilRow) => (r.vehicleId ? carName(vehicle(r.vehicleId)) : t('oil.row.noCar'));
export const lastWords = (r: OilRow) => (r.lastOil && (!r.lastVisit || r.lastOil >= r.lastVisit) ? t('oil.row.lastOil', { day: dateShort(r.lastOil) }) : t('oil.row.lastVisit', { day: dateShort(r.lastVisit as Day) }));
