/* What the team reads of a customer who does not have his new hours yet (Part 28, REARRANGE.md §3.2, §3.6, §3.7), from
   the phone's own copy (told.ts: the one rule, the server's twin):
   - ToldJobLine: the job screen's « Le rendez-vous » panel, one muted line while the appointment's own state is new /
     changed: « Le client n'a pas encore cette heure (il a eu : …). Elle part avec « Envoyer les heures aux clients ». »
     (owner / « Réserver »: the button is theirs).
   - ToldWarn: « Ma journée », on the next stop, before « Je pars »: « Denis n'a pas eu sa nouvelle heure : il attend … »
     (never told: « … n'a pas encore été averti de son rendez-vous. »). Words only: the « en route » text gives the time.
   - toldDayToast(before): called by a move's flow when no question « Texter … ? » is pending (it asked nothing, or after
     « Pas maintenant »), with the job as it was before the move. When the customer's TOLD day is today (or tomorrow
     once the evening lock is past: win_lock_due's rule) and the move changed his day or hours, and he is now due: a
     toast with that day's button (days F3). It reads the job's row now. */
import type { Job } from '../../data/types';
import { job as jobRow, allJobs, settings } from '../../data/select';
import { can } from '../../data/auth';
import { t } from '../../lib/i18n';
import { today, addDays, nowMinute } from '../../lib/dates';
import { Banner, toast } from '../../ui';
import { tellCtx, tellState, isDue, toldOf, toldWords, clientsDue } from '../../domain/jobs/told';
import { jobFirstName } from './select';
import { openTell } from './TellHost';

/** the job screen's line (owner / « Réserver »), nothing when he has his hours */
export function ToldJobLine(p: { job: Job }) {
  if (!can('book')) return null;
  if (!isDue(tellState(p.job, tellCtx()))) return null;
  const when = toldWords(p.job);
  return <p class="small muted" style={{ margin: 0 }} data-testid="told-job-line">{when ? t('tell.jobLine', { when }) : t('tell.neverTold')}</p>;
}

/** « Ma journée »: the next stop's customer does not have his hours */
export function ToldWarn(p: { job: Job }) {
  if (!isDue(tellState(p.job, tellCtx()))) return null;
  const name = jobFirstName(p.job);
  const told = toldWords(p.job);
  return <Banner kind="warn" data-testid="told-warn">{told ? t('tell.mechanic', { name, told }) : t('tell.mechanicNever', { name })}</Banner>;
}

/** the minute of the evening lock (settings.booking.win_lock_min, 18 h by default): from then, tomorrow counts as today */
function lockMinute(): number {
  const v = (settings.value.booking as { win_lock_min?: unknown }).win_lock_min;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 1080;
}
/** the day or the hours changed between two rows of one appointment */
const moved = (a: Job, b: Job) => a.day !== b.day || a.block !== b.block || (a.win_start ?? null) !== (b.win_start ?? null) || (a.win_end ?? null) !== (b.win_end ?? null);

/** after a move that asked nothing (or « Pas maintenant »): the customer expected today (or tomorrow after the evening
    lock) and his new hours have not gone → a toast with that day's button. Never throws. */
export function toldDayToast(before: Job): void {
  try {
    if (!can('book')) return;
    const now = jobRow(before.id);
    if (!now || !moved(before, now)) return;
    const told = toldOf(now) ?? toldOf(before);
    if (!told) return;
    const d = today();
    const near = told.day === d ? 'today' : told.day === addDays(d, 1) && nowMinute() >= lockMinute() ? 'tomorrow' : null;
    if (!near) return;
    const ctx = tellCtx();
    if (!isDue(tellState(now, ctx))) return;
    const n = clientsDue(told.day, allJobs.value, ctx);
    const day = t(near === 'today' ? 'tell.dayToday' : 'tell.dayTomorrow');
    toast(t('tell.toldTodayToast', { name: jobFirstName(now), day }), {
      kind: 'info', ms: 10000, action: { label: t('tell.button', { n }), run: () => openTell(told.day) }
    });
  } catch { /* a word the phone could not work out: the day's line still says it */ }
}
