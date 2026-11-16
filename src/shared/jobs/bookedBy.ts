/* « Réservé par »: who made the appointment and when (jobs.created_by, created_at, source). The customer on the booking
   page has no account (created_by is null): « Le client, en ligne ». */
import type { Job, Lang } from '../../data/types';
import { stamp } from '../../lib/dates';
import { tl } from '../../lib/i18n';

/** `name`: the team member's name as shown in the app ('' when this phone does not know them) */
export function bookedBy(j: Pick<Job, 'source' | 'created_by' | 'created_at'>, name: string, l: Lang): string | null {
  const when = stamp(j.created_at, l);
  if (j.source === 'web') return tl(l, 'jobs.moment.byWeb', { when });
  if (!j.created_by) return null;
  const who = name || tl(l, 'jobs.moment.bySomeone');
  return tl(l, j.source === 'walk_in' ? 'jobs.moment.byWalkIn' : j.source === 'quote' ? 'jobs.moment.byQuote' : 'jobs.moment.byStaff', { who, when });
}
