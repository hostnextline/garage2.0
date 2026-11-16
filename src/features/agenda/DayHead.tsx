/* The top of a day: the day in words with the days around (previous / next), the phone's own date picker, and the week
   as a strip of days with each day's count of jobs. */
import { useRef } from 'preact/hooks';
import { ChevronLeft, ChevronRight, CalendarSearch } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { addDays, longDay, isValidDay, parseDay, today as todayOf, type Day } from '../../lib/dates';
import { href } from '../../platform/router';
import { focusAfterNav } from '../../platform/focus';
import { IconButton } from '../../ui';
import { relativeDay } from '../../domain/moment/words';
import { weekOfDay } from './layout';
import { activeCount } from './select';

export function DayHead(p: { day: Day; onDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const rel = relativeDay(p.day, todayDay, l);
  return (
    <div class="agenda-dayhead" data-tour="agenda-day">
      <IconButton icon={<ChevronLeft />} label={t('agenda.day.prev')} onClick={() => { focusAfterNav('[data-testid="agenda-prev"]'); p.onDay(addDays(p.day, -1)); }} data-testid="agenda-prev" />
      <div class="agenda-dayhead-mid" aria-live="polite" aria-atomic="true">
        <span class={`agenda-rel${p.day === todayDay ? ' is-today' : ''}`}>{rel || ' '}</span>
        <span class="agenda-date" data-testid="agenda-date" tabIndex={-1}>{longDay(p.day, l)}</span>
      </div>
      <IconButton icon={<ChevronRight />} label={t('agenda.day.next')} onClick={() => { focusAfterNav('[data-testid="agenda-next"]'); p.onDay(addDays(p.day, 1)); }} data-testid="agenda-next" />
    </div>
  );
}

/** a calendar button that opens the phone's own date picker. Where the browser has no showPicker (Safari before 16,
    Firefox before 101) the field is focused and clicked instead: calling a missing method through `?.` throws nothing,
    so a try alone would leave the button dead there. */
export function DatePick(p: { value: Day; onPick: (d: Day) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = input.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    const fallback = () => { el.focus(); el.click(); };
    if (typeof el.showPicker !== 'function') { fallback(); return; }
    // showPicker refuses outside a user gesture or in a cross-origin frame: the plain click still opens it
    try { el.showPicker(); } catch { fallback(); }
  };
  return (
    <span class="agenda-datepick">
      <IconButton icon={<CalendarSearch />} label={t('agenda.day.pick')} onClick={open} data-testid="agenda-pick" />
      <input ref={input} type="date" class="agenda-datepick-input" tabIndex={-1} aria-hidden="true" value={p.value}
        onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; if (isValidDay(v)) { focusAfterNav('[data-testid="agenda-pick"]'); p.onPick(v); } }} />
    </span>
  );
}

/** the week, as a strip of days (tap one) */
export function WeekStrip(p: { day: Day; onDay: (d: Day) => void }) {
  const l = lang.value;
  const todayDay = todayOf();
  const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short' });
  return (
    <nav class="agenda-strip" aria-label={t('agenda.day.strip')}>
      {weekOfDay(p.day).map((d) => {
        const n = activeCount(d);
        return (
          <a key={d} href={href(`/agenda/${d}`)} class={`agenda-strip-day${d === todayDay ? ' is-today' : ''}`} aria-current={d === p.day ? 'date' : undefined}
            aria-label={`${longDay(d, l)}, ${t('agenda.day.count', { n })}`} onClick={(e) => { e.preventDefault(); focusAfterNav(`[data-testid="strip-${d}"]`); p.onDay(d); }} data-testid={`strip-${d}`}>
            <span class="agenda-strip-wd">{wd.format(parseDay(d)).replace('.', '')}</span>
            <span class="agenda-strip-num">{parseDay(d).getDate()}</span>
            <span class="agenda-strip-count" aria-hidden="true">{n > 0 ? n : ''}</span>
          </a>
        );
      })}
    </nav>
  );
}
