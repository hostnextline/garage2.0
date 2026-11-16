/* The time calendar of the booking screen on a phone (« Plages d'arrivée »): a row of days (each says how many arrival
   times are possible), then the arrival times of the day chosen, every 15 minutes, a line per hour, big enough for a
   thumb. A tap chooses the time; a long press opens the menu (« Voir sur la carte »). WindowPicker builds the days. */
import { useEffect, useRef } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Route } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clock, parseDay, type Day } from '../../lib/dates';
import { Skeleton } from '../../ui';
import { byHour } from '../../domain/moment/units';
import type { GridDay } from './windowDays';

export interface PickListProps {
  days: GridDay[]; today: Day; selDay: Day | null; onDay: (d: Day) => void;
  onTime: (d: Day, m: number) => void;
  unitLabel: (d: Day, m: number) => string;
  dayLabel: (d: GridDay) => string;
  /** the long press and the right-click of a time */
  menuOf: (d: Day, m: number) => Record<string, unknown>;
  /** moving an appointment: its time now (on the day chosen) */
  currentM: number | null;
  canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void;
}

export function PickList(p: PickListProps) {
  const l = lang.value;
  const wd = new Intl.DateTimeFormat(l === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'short' });
  const d = p.days.find((x) => x.day === p.selDay) || null;
  // the day chosen stays in view in the row of days
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chips.current;
    const el = row?.querySelector<HTMLElement>('.is-sel');
    if (row && el) row.scrollLeft = Math.max(0, el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
  }, [p.selDay, p.days[0]?.day]);
  return (
    <div class="pl" data-testid="pick-list">
      <div class="pl-days" role="group" aria-label={t('booking.win.grid.days')}>
        <button type="button" class="pk-nav" onClick={p.onPrev} disabled={!p.canPrev} aria-label={t('booking.win.grid.prev')} data-testid="pick-prev"><ChevronLeft size={20} aria-hidden="true" /></button>
        <div class="pl-chips" ref={chips}>
          {p.days.map((x) => (
            <button key={x.day} type="button" class={`pl-chip is-${x.kind}${x.day === p.selDay ? ' is-sel' : ''}${x.chosen != null ? ' has-chosen' : ''}${x.far ? ' is-far' : ''}`} aria-pressed={x.day === p.selDay} aria-label={p.dayLabel(x)}
              onClick={() => p.onDay(x.day)} data-testid={`pick-daychip-${x.day}`}>
              <span class="pl-chip-wd">{x.day === p.today ? t('common.today') : wd.format(parseDay(x.day))}</span>
              <span class="pl-chip-num">{parseDay(x.day).getDate()}</span>
              <span class="pl-chip-n">{x.far && x.kind === 'open' && <Route size={11} aria-hidden="true" />}{x.kind === 'open' ? t('booking.win.grid.count', { n: x.windows }) : x.kind === 'loading' ? '…' : t(`booking.win.grid.state.${x.kind}`)}</span>
            </button>
          ))}
        </div>
        <button type="button" class="pk-nav" onClick={p.onNext} disabled={!p.canNext} aria-label={t('booking.win.grid.next')} data-testid="pick-next"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      {d && d.kind === 'loading' && !d.open.length && <div aria-busy="true"><span class="sr-only">{t('booking.win.grid.state.loading')}</span><Skeleton h={48} lines={3} /></div>}
      {d && d.open.length > 0 && (
        <div class={`pl-times${d.stale ? ' is-stale' : ''}`} role="group" aria-label={t('booking.win.grid.times')} data-testid="pick-times">
          {byHour(d.open).map((h) => (
            <div class="pl-hour" key={h.hour}>
              <span class="pl-hour-name" aria-hidden="true">{clock(h.hour, l)}</span>
              {[0, 15, 30, 45].map((q) => {
                const m = h.hour + q;
                if (!h.times.includes(m)) return <span key={q} class="pl-gap" aria-hidden="true" />;
                const on = d.chosen === m;
                return (
                  <button key={q} type="button" class={`pl-time${on ? ' is-on' : ''}${d.best === m && !on ? ' is-best' : ''}${p.currentM === m ? ' is-current' : ''}`} aria-pressed={on} aria-label={p.unitLabel(d.day, m)}
                    onClick={() => p.onTime(d.day, m)} {...p.menuOf(d.day, m)} data-testid={`pick-time-${m}`}>
                    <span>{clock(m, l)}</span>
                    {p.currentM === m && <small>{t('booking.win.grid.current')}</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
