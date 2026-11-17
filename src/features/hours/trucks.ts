/* A truck's sheet: the coming appointments a change of the truck touches (taken out of service; its tire machine taken
   away, for the work that needs it). Pure (trucks.test.ts). */
import type { Job, Truck } from '../../data/types';
import type { Lang } from '../../lib/i18n';
import { t } from '../../lib/i18n';
import { listWords, dayMonth } from '../../domain/moment/words';

export function comingTouched(jobs: Job[], before: Pick<Truck, 'id' | 'active' | 'tire_machine'>, after: { active: boolean; tire_machine: boolean }, today: string): { why: 'off' | 'machine'; jobs: Job[] } | null {
  const coming = jobs.filter((j) => j.truck_id === before.id && j.status === 'booked' && !j.deleted_at && j.day >= today);
  if (before.active && !after.active) return coming.length ? { why: 'off', jobs: coming } : null;
  if (before.tire_machine !== false && !after.tire_machine) {
    const need = coming.filter((j) => j.needs_machine);
    return need.length ? { why: 'machine', jobs: need } : null;
  }
  return null;
}

/** which appointments the question is about (R90): « Marie (20 novembre), #1024 (21 novembre) et 3 autres », in day
    order; at most `max` named, the rest counted */
export function touchedWho(jobs: Job[], nameOf: (j: Job) => string, l: Lang, todayDay?: string, max = 5): string {
  const sorted = jobs.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.number ?? 0) - (b.number ?? 0)));
  const named = sorted.slice(0, sorted.length > max ? max - 1 : max)
    .map((j) => `${nameOf(j).trim() || (j.number != null ? `#${j.number}` : '—')} (${dayMonth(j.day, l, todayDay)})`);
  const rest = sorted.length - named.length;
  return listWords(rest > 0 ? [...named, t('hours.manage.askMore', { n: rest }, l)] : named, l);
}
