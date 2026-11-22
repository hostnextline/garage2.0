/* « Réserver à l'heure choisie » (Part 30): what is said once booked at a minute, and whether the new map of that day is
   shown (K3). Pure (atTimeSaid.test.ts): the words come from i18n, the late customers' new windows from `lateWindow`.
   - « Réservé : demain à 14 h. » (« Réservé quand même : … » when somebody was made late or the truck ends after its
     hours), then the late customers NAMED, so they can be called (the app texts them nothing): on a day other than today
     their new window leaves with « Envoyer les heures aux clients » (Part 28), else « Avertis Denis : servi après sa
     plage. » (the exact move's words);
   - the map: forced, or somebody else's hour changed (pushed later, or late);
   - `when`: the window of that minute in the booking text's words (for the text to send by hand). */
import { t } from '../../lib/i18n';
import { clock, type Day } from '../../lib/dates';
import { windowOf, job as jobRow } from '../../data/select';
import type { ExactStop } from '../../data/exact';
import { choiceWords } from '../../domain/moment/choice';
import { dayInSentence } from '../../domain/jobs/when';
import { jobPerson } from '../../domain/jobs/words';
import type { AtTimeDone } from './atTime';

export interface AtTimeSaid { text: string; kind: 'ok' | 'info'; ms?: number; when: string; map: boolean }

const nameOf = (id: string) => { const r = jobRow(id); return (r && jobPerson(r)) || t('booking.atTime.someone'); };

export function atTimeSaid(done: Extract<AtTimeDone, { kind: 'booked' }>, day: Day, l: 'fr' | 'en',
  lateWindow: (s: ExactStop, day: Day) => readonly [number, number] | null = () => null): AtTimeSaid {
  const a = done.answer;
  const win: readonly [number, number] = a?.winStart != null && a.winEnd != null ? [a.winStart, a.winEnd] : windowOf(done.at);
  const when = choiceWords({ day, block: 'day', win_start: win[0], win_end: win[1] }, l);
  const first = t(done.forced ? 'booking.atTime.doneForced' : 'booking.atTime.done', { when: dayInSentence(day, l), time: clock(done.at, l) });
  const stops = a?.stops ?? [];
  const gets = done.late.filter((id) => { const s = stops.find((x) => x.id === id); return !!s && lateWindow(s, day) != null; });
  const tell = done.late.filter((id) => !gets.includes(id));
  const names = (ids: string[]) => ids.map(nameOf).join(', ');
  const text = [first,
    gets.length ? t('jobs.exact.doneLate', { n: gets.length, names: names(gets) }) : '',
    tell.length ? t('jobs.exact.doneLateToday', { n: tell.length, names: names(tell) }) : ''].filter(Boolean).join(' ');
  return { text, kind: done.forced ? 'info' : 'ok', ms: done.late.length || done.forced ? 10000 : undefined, when,
    map: done.forced || done.late.length > 0 || done.pushed.length > 0 };
}
