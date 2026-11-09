/* Agenda — #/agenda/:day?  (query view=day|week)
   Phone: one day, its three blocks, each truck as a lane. Computer: the week as a grid (or one day, wider).
   A mechanic without the « agenda » right sees « Mon horaire »: his truck's jobs only. */
import { useEffect, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, ClipboardCopy } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { navigate, href } from '../../app/router';
import { wide } from '../../app/media';
import { t, lang } from '../../lib/i18n';
import { isValidDay, today as todayOf, type Day } from '../../lib/dates';
import { blocks, allJobs, job as jobRow } from '../../data/select';
import { may } from '../../app/routes';
import { net } from '../../data/sync';
import { Page, Banner, Button, IconButton, Seg, Skeleton, Panel } from '../../ui';
import { DayView, DatePick } from './DayView';
import { WeekGrid } from './WeekGrid';
import { shiftWeek, weekTitle, sameWeek } from './layout';
import { blockView, dayJobs, isOff, seesAll } from './select';
import { focusAfterNav, restoreFocus } from './focus';
import { ContextMenuHost } from './ContextMenu';
import { copiedJob, clearCopy } from './copy';
import { jobPerson } from './move';
import './agenda.css';

/** redraw every minute: blocks start, the day changes */
function useMinute() {
  const [, setN] = useState(0);
  useEffect(() => { const id = setInterval(() => setN((n) => n + 1), 60000); return () => clearInterval(id); }, []);
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
  const jobsToday = dayJobs(day).filter((j) => !isOff(j));
  // the trucks that work that day (on a past day: the ones that had jobs)
  const working = new Set(blocks.value.flatMap((b) => blockView(day, b, todayDay).lanes.filter((x) => x.cap > 0 || x.jobs.length > 0).map((x) => x.truck.id))).size;
  const sub = view === 'week' ? weekTitle(day, l) : t('agenda.day.summary', { jobs: t('agenda.day.count', { n: jobsToday.length }), trucks: t('agenda.day.trucks', { n: working }) });

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
    <Page title={mine ? t('agenda.titleMine') : t('agenda.title')} sub={sub} help={mine ? t('agenda.helpMine') : t('agenda.help')} actions={actions}
      wide={isWide && view === 'week'} data-testid="agenda-screen">
      {!net.value.online && <Banner kind="warn">{t('agenda.offline')}</Banner>}
      {may.book() && copiedJob.value && (() => {
        const cj = jobRow(copiedJob.value);
        return (
          <Banner kind="info" title={t('agenda.copy.bannerTitle', { name: cj ? jobPerson(cj) || `#${cj.number}` : '' })}
            action={<Button size="sm" icon={<ClipboardCopy size={16} />} onClick={clearCopy} data-testid="copy-clear">{t('agenda.copy.clear')}</Button>} data-testid="copy-banner">
            {t('agenda.copy.bannerText')}
          </Banner>
        );
      })()}
      {loading ? (
        <Panel><div aria-busy="true"><span class="sr-only">{t('agenda.loading')}</span><Skeleton h={22} w="40%" /><div style={{ height: '12px' }} /><Skeleton h={64} lines={3} /></div></Panel>
      ) : view === 'week' ? (
        <WeekGrid day={day} onOpenDay={(d) => { focusAfterNav('[data-testid="agenda-date"]'); go(d, 'day'); }} />
      ) : (
        <DayView day={day} onDay={(d) => go(d)} />
      )}
      <ContextMenuHost />
    </Page>
  );
}
