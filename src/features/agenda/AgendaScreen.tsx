/* Agenda — #/agenda/:day?  (query view=day|week)
   Phone: one day, its three blocks, each truck as a lane. Computer: the week as a grid (or one day, wider).
   A mechanic without the « agenda » right sees « Mon horaire »: his truck's jobs only.
   The days shown are drawn once per redraw (dayPlan) and handed down: the week's cells never redo it. */
import { useEffect, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, ClipboardCopy } from 'lucide-preact';
import { navigate, href, type ScreenProps } from '../../platform/router';
import { wide } from '../../platform/media';
import { focusAfterNav, restoreFocus } from '../../platform/focus';
import { t, lang } from '../../lib/i18n';
import { isValidDay, today as todayOf, type Day } from '../../lib/dates';
import { allJobs, windowsOn } from '../../data/select';
import { net } from '../../data/sync';
import { may } from '../../domain/rights';
import { jobPerson } from '../../domain/jobs/words';
import { Page, Banner, Button, IconButton, Seg, Skeleton, Panel } from '../../ui';
import { DayView } from './DayView';
import { DatePick } from './DayHead';
import { WeekGrid } from './WeekGrid';
import { shiftWeek, weekTitle, sameWeek, weekOfDay } from './layout';
import { dayPlan, activeCount, seesAll, workingTrucks } from './select';
import { copiedJob, copiedRow, clearCopy } from './copy';
import { MoveWindowHost } from './MoveWindowSheet';
import { DayOrderHost } from '../../shared/jobs/DayOrderHost';
import './agenda.css';

/** redraw every minute (blocks start, the « now » line, midnight) and when the app comes back to the front */
function useMinute() {
  const [, setN] = useState(0);
  useEffect(() => {
    const tick = () => setN((n) => n + 1);
    const id = setInterval(tick, 60000);
    const shown = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', shown);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', shown); };
  }, []);
}

/** « Rendez-vous copié : Julie » with « Oublier la copie », while the copied appointment is on this phone */
function CopyBanner() {
  const cj = copiedRow();
  const ready = net.value.ready;
  // a copy of an appointment this phone no longer holds (gone, or another account's) is forgotten once the phone's
  // copy is there (before, every job looks missing)
  useEffect(() => { if (ready && copiedJob.value && !cj) clearCopy(); }, [ready, cj]);
  if (!may.book() || !cj) return null;
  return (
    <Banner kind="info" title={t('agenda.copy.bannerTitle', { name: jobPerson(cj) || `#${cj.number}` })}
      action={<Button size="sm" icon={<ClipboardCopy size={16} />} onClick={clearCopy} data-testid="copy-clear">{t('agenda.copy.clear')}</Button>} data-testid="copy-banner">
      {t(windowsOn.value ? 'agenda.copy.bannerTextDay' : 'agenda.copy.bannerText')}
    </Banner>
  );
}

export default function AgendaScreen({ params, query }: ScreenProps) {
  useMinute();
  useEffect(restoreFocus, []);
  const l = lang.value;
  const todayDay = todayOf();
  const day: Day = isValidDay(params.day) ? params.day : todayDay;
  const isWide = wide.value;
  const view: 'day' | 'week' = isWide && query.get('view') !== 'day' ? 'week' : 'day';
  const mine = !seesAll();
  const go = (d: Day, v: 'day' | 'week' | null = isWide ? view : null) =>
    navigate(href(`/agenda/${d}`, { view: isWide && v === 'day' ? 'day' : null }).slice(1), { replace: true });

  const loading = !net.value.ready && allJobs.value.length === 0;
  const plans = view === 'week' ? weekOfDay(day).map((d) => dayPlan(d, todayDay)) : [dayPlan(day, todayDay)];
  const sub = view === 'week' ? weekTitle(day, l)
    : t('agenda.day.summary', { jobs: t('agenda.day.count', { n: activeCount(day) }), trucks: t('agenda.day.trucks', { n: workingTrucks(plans[0]) }) });

  const viewSeg = isWide ? (
    <Seg value={view} onValue={(v) => { focusAfterNav('[data-testid="agenda-view"] [aria-pressed="true"]'); go(day, v); }} label={t('agenda.week.view')} data-testid="agenda-view"
      options={[{ value: 'day', label: t('agenda.week.dayView') }, { value: 'week', label: t('agenda.week.weekView') }]} />
  ) : null;
  const actions = view === 'week' ? (
    <>
      <IconButton icon={<ChevronLeft />} label={t('agenda.week.prev')} onClick={() => { focusAfterNav('[data-testid="week-prev"]'); go(shiftWeek(day, -1)); }} data-testid="week-prev" />
      {!sameWeek(day, todayDay) && <Button size="sm" onClick={() => { focusAfterNav('[data-testid="week-next"]'); go(todayDay); }}>{t('agenda.week.thisWeek')}</Button>}
      <IconButton icon={<ChevronRight />} label={t('agenda.week.next')} onClick={() => { focusAfterNav('[data-testid="week-next"]'); go(shiftWeek(day, 1)); }} data-testid="week-next" />
      <DatePick value={day} onPick={(d) => go(d)} />
      {viewSeg}
    </>
  ) : (
    <>
      {day !== todayDay && <Button size="sm" onClick={() => { focusAfterNav('.agenda-strip [aria-current="date"]'); go(todayDay); }} data-testid="agenda-today">{t('agenda.day.today')}</Button>}
      <DatePick value={day} onPick={(d) => go(d)} />
      {viewSeg}
    </>
  );

  return (
    <Page title={mine ? t('agenda.titleMine') : t('agenda.title')} sub={sub} help={windowsOn.value ? (mine ? t('agenda.helpMineDay') : t('agenda.helpDay')) : mine ? t('agenda.helpMine') : t('agenda.help')} actions={actions}
      wide={isWide && view === 'week'} data-testid="agenda-screen">
      {!net.value.online && <Banner kind="warn">{t('agenda.offline')}</Banner>}
      <CopyBanner />
      {loading ? (
        <Panel><div aria-busy="true"><span class="sr-only">{t('agenda.loading')}</span><Skeleton h={22} w="40%" /><div style={{ height: '12px' }} /><Skeleton h={64} lines={3} /></div></Panel>
      ) : view === 'week' ? (
        <WeekGrid day={day} plans={plans} onOpenDay={(d) => { focusAfterNav('[data-testid="agenda-date"]'); go(d, 'day'); }} />
      ) : (
        <DayView day={day} plan={plans[0]} onDay={(d) => go(d)} />
      )}
      <MoveWindowHost />
      {/* « Réorganiser la journée » (the day bar, the week's block menu, a stop's menu): the sheet on the agenda */}
      <DayOrderHost />
    </Page>
  );
}
