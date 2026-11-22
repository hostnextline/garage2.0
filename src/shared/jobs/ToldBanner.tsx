/* « N clients n'ont pas leur nouvelle heure » (Part 28, REARRANGE.md §3.2, T4), from the phone's own copy (its jobs, the
   told_* columns with them, and the settings: no request). Owner / « Réserver » only; nothing when nobody is due.
   - ToldBanner(day): the agenda's day bar: that day's line and « Envoyer les heures aux clients (N) ».
   - ToldDays(): Aujourd'hui's ONE line of every coming day with customers due (the lead's addition to days F3, so nobody
     due after tomorrow is forgotten): N = distinct customers over every day listed, then one button per day in date
     order (« aujourd'hui (1) », « demain (1) », « mar. 24 (2) »), each opening that day's list. A customer due on two
     days (moved from today to Monday) counts once and is on both days' buttons. */
import { Send } from 'lucide-preact';
import { allJobs } from '../../data/select';
import { can } from '../../data/auth';
import { t, lang } from '../../lib/i18n';
import { addDays, tinyDay, today } from '../../lib/dates';
import { Banner, Button } from '../../ui';
import { tellCtx, clientsDue, dueDays } from '../../domain/jobs/told';
import { openTell } from './TellHost';

/** « aujourd'hui », « demain », else « mar. 24 » */
export function dayChipWord(day: string, l = lang.value): string {
  const d = today();
  if (day === d) return t('tell.dayToday', undefined, l);
  if (day === addDays(d, 1)) return t('tell.dayTomorrow', undefined, l);
  return tinyDay(day, l);
}

/* The buttons go UNDER the line, inside the Banner's text (not its `action`, which the kit keeps beside the text, never
   wrapping): on a phone (390 px) the longest English line and a week of day buttons fit, the buttons wrap. */
const UNDER = { marginTop: 'var(--sp-2)' };

/** the day's line with its button (nothing when nobody is due that day, or for a mechanic) */
export function ToldBanner(p: { day: string }) {
  if (!can('book')) return null;
  const n = clientsDue(p.day, allJobs.value, tellCtx());
  if (!n) return null;
  return (
    <Banner kind="warn" title={t('tell.line', { n })} data-testid="told-banner">
      <div class="row-wrap" style={UNDER}>
        <Button size="sm" icon={<Send size={16} />} onClick={() => openTell(p.day)} data-testid="told-banner-send">{t('tell.button', { n })}</Button>
      </div>
    </Banner>
  );
}

/** Aujourd'hui: one line for every coming day with customers due, a button per day */
export function ToldDays() {
  if (!can('book')) return null;
  const { days, total } = dueDays(allJobs.value, tellCtx());
  if (!total) return null;
  return (
    <Banner kind="warn" title={t('tell.line', { n: total })} data-testid="told-days">
      <div class="row-wrap" style={UNDER}>{days.map((d) => (
        <Button key={d.day} size="sm" onClick={() => openTell(d.day)} data-testid={`told-day-${d.day}`}>{t('tell.dayChip', { day: dayChipWord(d.day), n: d.n })}</Button>
      ))}</div>
    </Banner>
  );
}
