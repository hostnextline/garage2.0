/* The words beside a map of the moment pickers whose roads are not all drawn (build-maps « For the lead », fix-maps):
   being asked, no planner answered, impossible to draw. Its own module: « Voir sur la carte » (RoutePreview),
   « Choisir sur la carte » (MomentMap) and the day map (DayRoute) say it the same way. */
import { t } from '../../lib/i18n';
import type { TruckRoute } from '../map/assemble';
import { roadState, type RoadState } from '../map/useRoads';

/** '' when every route of `trucks` is drawn for that day */
export function roadNote(trucks: TruckRoute[], day: string | null | undefined): string {
  const states: RoadState[] = trucks.map((tr) => roadState(tr, day));
  if (states.includes('asking')) return t('map.roadNote.asking');
  if (states.includes('down')) return t('map.roadNote.none');
  if (states.includes('never')) return t('map.roadNote.never');
  return '';
}
